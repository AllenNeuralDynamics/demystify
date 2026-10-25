import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands'
import { snippet } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  showTooltip,
  type DecorationSet,
  type Tooltip,
} from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { yCollab } from 'y-codemirror.next'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { getCommentRange } from '../lib/commentAnchors'
import { getCitationInsertion } from '../lib/citationInsertion'
import {
  fillSnippetSelection,
  mystAuthoringCompletionSource,
} from '../lib/mystAuthoring'
import {
  rebaseTextDraft,
  type CollaborativeTextEditResult,
} from '../lib/collaborativeTextEdit'
import type { LinkedScrollAnchor } from '../lib/linkedScroll'
import type { EditorCommandState } from './EditorPaneToolbar'

export interface CommentHighlight {
  id: string
  from: number
  to: number
  resolved: boolean
  active: boolean
}

export interface SourceSuggestionHighlight {
  id: string
  from: number
  to: number
  before?: string
  after: string
  authorName: string
  authorColor: string
  active: boolean
  projection?: 'accepted' | 'working'
}

interface CollaborativeEditorProps {
  sharedText: Y.Text
  provider: WebsocketProvider
  commentHighlights?: CommentHighlight[]
  onCommentClick?: (commentId: string) => void
  onCommentSelection?: () => void
  onProposeSourceEdit?: (draft: string) => {
    result: CollaborativeTextEditResult
    suggestionId?: string
  }
  onScrollAnchor?: (anchor: LinkedScrollAnchor) => void
  onSourceDraftChange?: (draft: string | null) => void
  onCommandStateChange?: (state: EditorCommandState) => void
  readOnly?: boolean
  formatting?: boolean
  suggestionBaseContent?: string
  suggestionMode?: boolean
  suggestionHighlights?: SourceSuggestionHighlight[]
}

export interface CollaborativeEditorHandle {
  undo: () => void
  redo: () => void
  wrapSelection: (before: string, after?: string) => void
  insertSnippet: (template: string, selectedTextPlaceholder?: string) => void
  insertText: (text: string) => void
  insertCitation: (citation: string) => void
  getCommentSelection: () => { from: number; to: number } | null
  revealRange: (from: number, to: number, focus?: boolean) => void
  revealPosition: (position: number) => void
  getScrollAnchor: () => LinkedScrollAnchor
  setScrollAnchor: (anchor: LinkedScrollAnchor) => void
  focus: () => void
}

interface ReviewDecorations {
  comments: CommentHighlight[]
  suggestions: SourceSuggestionHighlight[]
}

const setReviewDecorations = StateEffect.define<ReviewDecorations>()
const suggestionSaveDelayMs = 450
const linkedScrollTolerance = 0.002

const formatSourceSelection = (view: EditorView, before: string, after: string,
  undoManager: Y.UndoManager | null) => {
  if (view.state.readOnly) return false
  const { from, to } = view.state.selection.main
  const selectedText = view.state.sliceDoc(from, to)
  let start = from
  let end = to
  let insert = `${before}${selectedText}${after}`
  let selectionStart = from + before.length
  let selectionEnd = to + before.length
  if (before === after && ['**', '*', '`'].includes(before)) {
    const selectedStars = selectedText.match(/^\*+/)?.[0].length ?? 0
    const trailingStars = selectedText.match(/\*+$/)?.[0].length ?? 0
    const wrapsSelection = selectedText.length >= before.length * 2 &&
      selectedText.startsWith(before) && selectedText.endsWith(before) &&
      (before !== '*' || (selectedStars % 2 === 1 && trailingStars % 2 === 1))
    const left = view.state.sliceDoc(view.state.doc.lineAt(from).from, from)
    const right = view.state.sliceDoc(to, view.state.doc.lineAt(to).to)
    const surroundsSelection = left.endsWith(before) && right.startsWith(before) &&
      (before !== '*' || ((left.match(/\*+$/)?.[0].length ?? 0) % 2 === 1 &&
        (right.match(/^\*+/)?.[0].length ?? 0) % 2 === 1))
    if (wrapsSelection) {
      insert = selectedText.slice(before.length, -before.length)
      selectionStart = from
      selectionEnd = from + insert.length
    } else if (surroundsSelection) {
      start -= before.length
      end += before.length
      insert = selectedText
      selectionStart = start
      selectionEnd = start + insert.length
    }
  }
  undoManager?.stopCapturing()
  view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: selectionStart, head: selectionEnd } })
  undoManager?.stopCapturing()
  view.focus()
  return true
}

const getSelectionCommentTooltips = (
  state: EditorState,
  onComment: () => void,
): readonly Tooltip[] => {
  const range = state.selection.main
  if (range.empty) return []
  return [{
    pos: range.head,
    above: range.head < range.anchor,
    strictSide: true,
    arrow: false,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'cm-selection-comment'
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Comment'
      button.title = 'Comment on selection'
      // Keep the editor selection while the button is pressed.
      button.addEventListener('mousedown', (event) => event.preventDefault())
      button.addEventListener('click', onComment)
      dom.append(button)
      return { dom }
    },
  }]
}

const selectionCommentTooltip = (onComment: () => void) => StateField.define<readonly Tooltip[]>({
  create: (state) => getSelectionCommentTooltips(state, onComment),
  update: (tooltips, transaction) => transaction.docChanged || transaction.selection
    ? getSelectionCommentTooltips(transaction.state, onComment)
    : tooltips,
  provide: (field) => showTooltip.computeN([field], (state) => state.field(field)),
})

const getViewScrollAnchor = (view: EditorView): LinkedScrollAnchor => {
  const scrollRange = view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight
  const progress = scrollRange > 0 ? view.scrollDOM.scrollTop / scrollRange : 0
  const documentHeight = Math.max(
    0,
    view.scrollDOM.scrollTop + view.scrollDOM.clientHeight / 2 - view.documentPadding.top,
  )
  return {
    position: view.lineBlockAtHeight(documentHeight).from,
    progress,
  }
}

const setViewScrollAnchor = (view: EditorView, anchor: LinkedScrollAnchor) => {
  const scrollRange = Math.max(0, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight)
  let scrollTop = Math.max(0, Math.min(1, anchor.progress)) * scrollRange
  if (anchor.progress <= linkedScrollTolerance) {
    scrollTop = 0
  } else if (anchor.position !== null) {
    const position = Math.max(0, Math.min(view.state.doc.length, anchor.position))
    const block = view.lineBlockAt(position)
    scrollTop = view.documentPadding.top + block.top + block.height / 2 -
      view.scrollDOM.clientHeight / 2
  }
  const nextProgress = scrollRange > 0
    ? Math.max(0, Math.min(scrollRange, scrollTop)) / scrollRange
    : 0
  view.scrollDOM.scrollTop = nextProgress * scrollRange
  return nextProgress
}

class SuggestionWidget extends WidgetType {
  private readonly suggestion: SourceSuggestionHighlight

  constructor(suggestion: SourceSuggestionHighlight) {
    super()
    this.suggestion = suggestion
  }

  eq(other: SuggestionWidget) {
    return JSON.stringify(this.suggestion) === JSON.stringify(other.suggestion)
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = [
      'cm-suggestion-proposal',
      this.suggestion.active ? 'is-active' : '',
    ].filter(Boolean).join(' ')
    wrapper.dataset.commentId = this.suggestion.id
    wrapper.tabIndex = 0
    wrapper.setAttribute('role', 'button')
    wrapper.setAttribute(
      'aria-label',
      `Proposed source by ${this.suggestion.authorName}. Press Enter to open the review discussion.`,
    )
    wrapper.title = `Suggested by ${this.suggestion.authorName}; open review discussion`
    wrapper.style.setProperty('--cm-suggestion-color', this.suggestion.authorColor)
    wrapper.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      wrapper.click()
    })

    const prefix = document.createElement('span')
    prefix.className = 'cm-suggestion-prefix'
    prefix.textContent = this.suggestion.after ? '+' : 'delete'
    prefix.setAttribute('aria-hidden', 'true')

    const source = document.createElement('span')
    source.className = 'cm-suggestion-source'
    source.textContent = this.suggestion.after || 'Delete without replacement'

    const author = document.createElement('span')
    author.className = 'cm-suggestion-author'
    author.textContent = this.suggestion.authorName

    wrapper.append(prefix, source, author)
    return wrapper
  }

  ignoreEvent() {
    return false
  }
}

class WorkingDeletionWidget extends WidgetType {
  private readonly suggestion: SourceSuggestionHighlight

  constructor(suggestion: SourceSuggestionHighlight) {
    super()
    this.suggestion = suggestion
  }

  eq(other: WorkingDeletionWidget) {
    return JSON.stringify(this.suggestion) === JSON.stringify(other.suggestion)
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = [
      'cm-suggestion-deletion-widget',
      this.suggestion.active ? 'is-active' : '',
    ].filter(Boolean).join(' ')
    wrapper.dataset.commentId = this.suggestion.id
    wrapper.tabIndex = 0
    wrapper.setAttribute('role', 'button')
    wrapper.setAttribute(
      'aria-label',
      `Suggested deletion by ${this.suggestion.authorName}. Press Enter to open review.`,
    )
    wrapper.title = `Suggested deletion by ${this.suggestion.authorName}; open review`
    wrapper.style.setProperty('--cm-suggestion-color', this.suggestion.authorColor)

    const prefix = document.createElement('span')
    prefix.className = 'cm-suggestion-prefix'
    prefix.textContent = '-'
    prefix.setAttribute('aria-hidden', 'true')

    const source = document.createElement('del')
    source.className = 'cm-suggestion-deleted-source'
    source.textContent = this.suggestion.before ?? ''
    wrapper.append(prefix, source)
    return wrapper
  }

  ignoreEvent() {
    return false
  }
}

const commentHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    for (const effect of transaction.effects) {
      if (!effect.is(setReviewDecorations)) continue
      const commentDecorations = effect.value.comments
        .filter((highlight) => highlight.to > highlight.from)
        .map((highlight) => Decoration.mark({
          class: [
            'cm-comment-anchor',
            highlight.resolved ? 'is-resolved' : '',
            highlight.active ? 'is-active' : '',
          ].filter(Boolean).join(' '),
          attributes: { 'data-comment-id': highlight.id },
        }).range(highlight.from, highlight.to))
      const suggestionGroups = new Map<string, SourceSuggestionHighlight[]>()
      effect.value.suggestions
        .filter((suggestion) => suggestion.projection !== 'working')
        .forEach((suggestion) => {
          const key = `${suggestion.from}:${suggestion.to}`
          const group = suggestionGroups.get(key) ?? []
          group.push(suggestion)
          suggestionGroups.set(key, group)
        })
      const suggestionDecorations = Array.from(suggestionGroups.values())
        .flatMap((suggestions) => {
          const first = suggestions[0]
          if (!first || first.to < first.from) return []
          const deletion = first.to > first.from
            ? [Decoration.mark({
                class: [
                  'cm-suggestion-deletion',
                  suggestions.some((suggestion) => suggestion.active) ? 'is-active' : '',
                ].filter(Boolean).join(' '),
                attributes: {
                  'data-comment-id': first.id,
                  title: `Suggested deletion with ${suggestions.length} proposed replacement${suggestions.length === 1 ? '' : 's'}`,
                },
              }).range(first.from, first.to)]
            : []
          const proposals = suggestions.map((suggestion, index) =>
            Decoration.widget({
              widget: new SuggestionWidget(suggestion),
              side: index + 1,
            }).range(suggestion.to))
          return [...deletion, ...proposals]
        })
      const workingSuggestionDecorations = effect.value.suggestions
        .filter((suggestion) =>
          suggestion.projection === 'working' &&
          suggestion.from >= 0 &&
          suggestion.to >= suggestion.from &&
          suggestion.to <= transaction.state.doc.length)
        .flatMap((suggestion) => {
          const deletion = suggestion.before
            ? [Decoration.widget({
                widget: new WorkingDeletionWidget(suggestion),
                side: -1,
              }).range(suggestion.from)]
            : []
          const insertionStyle = document.createElement('span').style
          insertionStyle.setProperty('--cm-suggestion-color', suggestion.authorColor)
          const insertion = suggestion.to > suggestion.from
            ? [Decoration.mark({
                class: [
                  'cm-suggestion-insertion',
                  suggestion.active ? 'is-active' : '',
                ].filter(Boolean).join(' '),
                attributes: {
                  'aria-label': `Suggested insertion by ${suggestion.authorName}. Press Enter to open review.`,
                  'data-comment-id': suggestion.id,
                  style: insertionStyle.cssText,
                  role: 'button',
                  tabindex: '0',
                  title: `Suggested insertion by ${suggestion.authorName}; open review`,
                },
              }).range(suggestion.from, suggestion.to)]
            : []
          return [...deletion, ...insertion]
        })
      return Decoration.set(
        [
          ...commentDecorations,
          ...suggestionDecorations,
          ...workingSuggestionDecorations,
        ],
        true,
      )
    }
    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const editorTheme = EditorView.theme({
  '.cm-tooltip.cm-selection-comment': {
    border: 'none',
    background: 'transparent',
  },
  '.cm-selection-comment button': {
    padding: '6px 10px',
    border: '1px solid #dadce0',
    borderRadius: '6px',
    background: '#fff',
    color: '#1a73e8',
    fontFamily: '"IBM Plex Sans", sans-serif',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    boxShadow: '0 2px 6px rgb(0 0 0 / 18%)',
  },
  '&': {
    height: '100%',
    background: '#fff',
    color: '#202124',
  },
  '.cm-scroller': {
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: '14px',
    lineHeight: '1.75',
    padding: '24px 12px 40vh 18px',
  },
  '.cm-content': {
    maxWidth: '780px',
    margin: '0 auto',
    caretColor: 'var(--editor-accent, #1a73e8)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--editor-accent, #1a73e8)',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    background: '#fff',
    border: 'none',
    color: '#68716c',
  },
  '.cm-activeLine': {
    background: 'transparent',
  },
  '.cm-activeLineGutter': {
    background: '#f1f3f4',
    color: '#202124',
    fontWeight: '600',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: '#d9e9f8',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: '#b7d8f6',
  },
  '.cm-selectionMatch, .cm-selectionMatch-main': {
    backgroundColor: 'transparent',
  },
  '.cm-comment-anchor': {
    background: '#ffe9a8',
    borderBottom: '2px solid #c58c00',
    cursor: 'pointer',
  },
  '.cm-comment-anchor.is-active': {
    background: '#ffd86b',
    borderBottomColor: '#765200',
  },
  '.cm-comment-anchor.is-resolved': {
    background: '#e7ebe8',
    borderBottomColor: '#8b948f',
  },
  '.cm-suggestion-deletion': {
    background: '#fff1ee',
    borderBottom: '2px solid #a64b36',
    color: '#725b55',
    cursor: 'pointer',
    textDecoration: 'line-through',
    textDecorationColor: '#a64b36',
    textDecorationThickness: '1.5px',
  },
  '.cm-suggestion-deletion.is-active': {
    background: '#ffe3dc',
  },
  '.cm-suggestion-deletion-widget': {
    display: 'inline',
    marginRight: '3px',
    padding: '1px 3px',
    borderBottom: '2px solid #a64b36',
    background: '#fff1ee',
    color: '#725b55',
    cursor: 'pointer',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  '.cm-suggestion-deletion-widget.is-active': {
    outline: '2px solid #a64b36',
    outlineOffset: '2px',
  },
  '.cm-suggestion-deleted-source': {
    textDecorationColor: '#a64b36',
    textDecorationThickness: '1.5px',
  },
  '.cm-suggestion-insertion': {
    borderBottom: '2px solid var(--cm-suggestion-color, #16705d)',
    background: 'transparent',
    color: '#202124',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  '.cm-suggestion-insertion.is-active': {
    outline: '2px solid var(--cm-suggestion-color, #16705d)',
    outlineOffset: '2px',
  },
  '.cm-suggestion-proposal': {
    display: 'inline',
    marginLeft: '7px',
    padding: '1px 3px',
    borderBottom: '2px solid var(--cm-suggestion-color, #16705d)',
    background: 'transparent',
    color: '#202124',
    cursor: 'pointer',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  '.cm-suggestion-proposal.is-active': {
    outline: '2px solid var(--cm-suggestion-color, #16705d)',
    outlineOffset: '2px',
  },
  '.cm-suggestion-proposal:focus': {
    outline: '2px solid var(--cm-suggestion-color, #16705d)',
    outlineOffset: '2px',
  },
  '.cm-suggestion-prefix': {
    marginRight: '4px',
    color: 'var(--cm-suggestion-color, #16705d)',
    fontWeight: '600',
  },
  '.cm-suggestion-source': {
    color: 'inherit',
  },
  '.cm-suggestion-author': {
    display: 'inline-block',
    marginLeft: '6px',
    padding: '0 4px',
    border: '1px solid var(--cm-suggestion-color, #16705d)',
    borderRadius: '3px',
    color: 'var(--cm-suggestion-color, #16705d)',
    fontFamily: '"IBM Plex Sans", sans-serif',
    fontSize: '9px',
    fontWeight: '600',
    lineHeight: '1.4',
  },
})

export const CollaborativeEditor = forwardRef<
  CollaborativeEditorHandle,
  CollaborativeEditorProps
>(({
  sharedText,
  provider,
  commentHighlights = [],
  onCommentClick,
  onCommentSelection,
  onProposeSourceEdit,
  onScrollAnchor,
  onSourceDraftChange,
  onCommandStateChange,
  readOnly = false,
  formatting = true,
  suggestionBaseContent,
  suggestionMode = false,
  suggestionHighlights = [],
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const undoManagerRef = useRef<Y.UndoManager | null>(null)
  const refreshCommandsRef = useRef<() => void>(() => {})
  const commandStateRef = useRef<EditorCommandState | null>(null)
  const onCommandStateChangeRef = useRef(onCommandStateChange)
  const draftBaseRef = useRef(suggestionBaseContent ?? sharedText.toString())
  const suggestionBaseContentRef = useRef(suggestionBaseContent ?? sharedText.toString())
  const draftDirtyRef = useRef(false)
  const syncingDraftRef = useRef(false)
  const onCommentClickRef = useRef(onCommentClick)
  const onCommentSelectionRef = useRef(onCommentSelection)
  const canCommentOnSelectionRef = useRef(Boolean(onCommentSelection))
  const selectionCommentCompartmentRef = useRef(new Compartment())
  const onProposeSourceEditRef = useRef(onProposeSourceEdit)
  const onScrollAnchorRef = useRef(onScrollAnchor)
  const expectedScrollProgressRef = useRef<number | null>(null)
  const onSourceDraftChangeRef = useRef(onSourceDraftChange)
  const readOnlyRef = useRef(readOnly)
  const formattingRef = useRef(formatting)
  const readOnlyCompartmentRef = useRef(new Compartment())
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftVersion, setDraftVersion] = useState(0)

  useEffect(() => {
    onCommentClickRef.current = onCommentClick
  }, [onCommentClick])

  useEffect(() => {
    onCommentSelectionRef.current = onCommentSelection
    const canComment = Boolean(onCommentSelection)
    if (canComment === canCommentOnSelectionRef.current) return
    canCommentOnSelectionRef.current = canComment
    viewRef.current?.dispatch({
      effects: selectionCommentCompartmentRef.current.reconfigure(
        canComment ? selectionCommentTooltip(() => onCommentSelectionRef.current?.()) : [],
      ),
    })
  }, [onCommentSelection])

  useEffect(() => {
    onProposeSourceEditRef.current = onProposeSourceEdit
  }, [onProposeSourceEdit])

  useEffect(() => {
    onScrollAnchorRef.current = onScrollAnchor
  }, [onScrollAnchor])

  useEffect(() => {
    onSourceDraftChangeRef.current = onSourceDraftChange
  }, [onSourceDraftChange])

  useEffect(() => {
    onCommandStateChangeRef.current = onCommandStateChange
  }, [onCommandStateChange])

  useEffect(() => { formattingRef.current = formatting }, [formatting])

  useEffect(() => {
    if (!containerRef.current) return

    const undoManager = new Y.UndoManager(sharedText, { trackedOrigins: new Set() })
    undoManagerRef.current = undoManager
    const state = EditorState.create({
      doc: suggestionMode ? suggestionBaseContentRef.current : sharedText.toString(),
      extensions: [
        keymap.of([
          { key: 'Mod-b', run: (view) => formattingRef.current && formatSourceSelection(view, '**', '**', undoManager) },
          { key: 'Mod-i', run: (view) => formattingRef.current && formatSourceSelection(view, '*', '*', undoManager) },
          { key: 'Mod-`', run: (view) => formattingRef.current && formatSourceSelection(view, '`', '`', undoManager) },
        ]),
        basicSetup,
        markdown(),
        markdownLanguage.data.of({ autocomplete: mystAuthoringCompletionSource }),
        EditorView.contentAttributes.of({
          'aria-label': 'MyST source',
          tabindex: '0',
        }),
        EditorView.lineWrapping,
        editorTheme,
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(readOnlyRef.current),
          EditorView.editable.of(!readOnlyRef.current),
        ]),
        commentHighlightField,
        EditorView.updateListener.of(() => refreshCommandsRef.current()),
        selectionCommentCompartmentRef.current.of(
          canCommentOnSelectionRef.current
            ? selectionCommentTooltip(() => onCommentSelectionRef.current?.())
            : [],
        ),
        EditorView.domEventHandlers({
          click: (event) => {
            const target = event.target
            if (!(target instanceof HTMLElement)) return false
            const commentId = target.closest<HTMLElement>('[data-comment-id]')
              ?.dataset.commentId
            if (!commentId) return false
            onCommentClickRef.current?.(commentId)
            return true
          },
        }),
        ...(suggestionMode
          ? [EditorView.updateListener.of((update) => {
              if (!update.docChanged || syncingDraftRef.current) return
              draftDirtyRef.current = true
              setDraftDirty(true)
              setDraftError(null)
              setDraftVersion((version) => version + 1)
              onSourceDraftChangeRef.current?.(update.state.doc.toString())
            })]
          : [yCollab(sharedText, provider.awareness, { undoManager })]),
      ],
    })
    const view = new EditorView({ state, parent: containerRef.current })
    const reportScrollAnchor = () => {
      const anchor = getViewScrollAnchor(view)
      const expectedProgress = expectedScrollProgressRef.current
      if (expectedProgress !== null) {
        if (Math.abs(anchor.progress - expectedProgress) <= linkedScrollTolerance) return
        expectedScrollProgressRef.current = null
      }
      onScrollAnchorRef.current?.(anchor)
    }
    view.scrollDOM.addEventListener('scroll', reportScrollAnchor, { passive: true })
    const activateReviewFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const proposal = target.closest<HTMLElement>([
        '.cm-suggestion-proposal',
        '.cm-suggestion-insertion',
        '.cm-suggestion-deletion-widget',
      ].join(', '))
      const commentId = proposal?.dataset.commentId
      if (!commentId) return
      event.preventDefault()
      event.stopPropagation()
      onCommentClickRef.current?.(commentId)
    }
    view.dom.addEventListener('keydown', activateReviewFromKeyboard, true)
    viewRef.current = view
    const refreshCommands = () => {
      const next: EditorCommandState = {
        canUndo: suggestionMode ? undoDepth(view.state) > 0 : undoManager.undoStack.length > 0,
        canRedo: suggestionMode ? redoDepth(view.state) > 0 : undoManager.redoStack.length > 0,
        blocked: readOnlyRef.current,
      }
      const previous = commandStateRef.current
      if (previous && previous.canUndo === next.canUndo && previous.canRedo === next.canRedo && previous.blocked === next.blocked) return
      commandStateRef.current = next
      onCommandStateChangeRef.current?.(next)
    }
    refreshCommandsRef.current = refreshCommands
    undoManager.on('stack-item-added', refreshCommands)
    undoManager.on('stack-item-updated', refreshCommands)
    undoManager.on('stack-item-popped', refreshCommands)
    undoManager.on('stack-cleared', refreshCommands)
    refreshCommands()
    draftBaseRef.current = suggestionMode
      ? suggestionBaseContentRef.current
      : sharedText.toString()
    draftDirtyRef.current = false
    setDraftDirty(false)
    setDraftError(null)
    onSourceDraftChangeRef.current?.(null)

    return () => {
      view.scrollDOM.removeEventListener('scroll', reportScrollAnchor)
      view.dom.removeEventListener('keydown', activateReviewFromKeyboard, true)
      undoManager.off('stack-item-added', refreshCommands)
      undoManager.off('stack-item-updated', refreshCommands)
      undoManager.off('stack-item-popped', refreshCommands)
      undoManager.off('stack-cleared', refreshCommands)
      refreshCommandsRef.current = () => {}
      commandStateRef.current = null
      view.destroy()
      undoManager.destroy()
      undoManagerRef.current = null
      viewRef.current = null
    }
  }, [provider, sharedText, suggestionMode])

  useEffect(() => {
    if (!suggestionMode) return
    const nextBase = suggestionBaseContent ?? sharedText.toString()
    suggestionBaseContentRef.current = nextBase
    const view = viewRef.current
    if (!view || nextBase === draftBaseRef.current) return
    if (draftDirtyRef.current) {
      const rebasedDraft = rebaseTextDraft(
        draftBaseRef.current,
        view.state.doc.toString(),
        nextBase,
      )
      if (rebasedDraft === null) {
        setDraftError('Another suggestion changed the same source range. Undo or retry from the shared version.')
        return
      }
      syncingDraftRef.current = true
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: rebasedDraft },
      })
      syncingDraftRef.current = false
      draftBaseRef.current = nextBase
      setDraftError(null)
      onSourceDraftChangeRef.current?.(rebasedDraft)
      return
    }
    draftBaseRef.current = nextBase
    if (view.state.doc.toString() === nextBase) return
    syncingDraftRef.current = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextBase },
    })
    syncingDraftRef.current = false
  }, [sharedText, suggestionBaseContent, suggestionMode])

  useEffect(() => {
    if (!suggestionMode || !draftDirty || draftError) return
    const timeout = window.setTimeout(() => {
      const view = viewRef.current
      const propose = onProposeSourceEditRef.current
      if (!view || !propose) return
      const draft = view.state.doc.toString()
      if (draft === draftBaseRef.current) {
        draftDirtyRef.current = false
        setDraftDirty(false)
        onSourceDraftChangeRef.current?.(null)
        return
      }
      const proposal = propose(draft)
      if (proposal.result !== 'applied') {
        setDraftError(
          proposal.result === 'conflict'
            ? 'The source changed before this suggestion could be anchored.'
            : 'Suggestions are not available for this document.',
        )
        return
      }
      suggestionBaseContentRef.current = draft
      draftBaseRef.current = draft
      draftDirtyRef.current = false
      setDraftDirty(false)
      setDraftError(null)
      onSourceDraftChangeRef.current?.(null)
    }, suggestionSaveDelayMs)
    return () => window.clearTimeout(timeout)
  }, [draftDirty, draftError, draftVersion, suggestionMode])

  useEffect(() => {
    readOnlyRef.current = readOnly
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    })
  }, [readOnly])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setReviewDecorations.of({
        comments: commentHighlights,
        suggestions: suggestionMode && draftDirty ? [] : suggestionHighlights,
      }),
    })
  }, [commentHighlights, draftDirty, suggestionHighlights, suggestionMode])

  useImperativeHandle(ref, () => ({
    undo: () => {
      const view = viewRef.current
      if (!view || readOnlyRef.current) return
      if (suggestionMode) undo(view)
      else undoManagerRef.current?.undo()
      view.focus()
    },
    redo: () => {
      const view = viewRef.current
      if (!view || readOnlyRef.current) return
      if (suggestionMode) redo(view)
      else undoManagerRef.current?.redo()
      view.focus()
    },
    wrapSelection: (before, after = before) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current || !formattingRef.current) return
      formatSourceSelection(view, before, after, undoManagerRef.current)
    },
    insertSnippet: (template, selectedTextPlaceholder) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current) return
      const { from, to } = view.state.selection.main
      const selectedText = view.state.sliceDoc(from, to)
      const resolvedTemplate = fillSnippetSelection(
        template,
        selectedTextPlaceholder,
        selectedText,
      )
      undoManagerRef.current?.stopCapturing()
      snippet(resolvedTemplate)(view, null, from, to)
      undoManagerRef.current?.stopCapturing()
      view.focus()
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current || !text) return
      const { from, to } = view.state.selection.main
      undoManagerRef.current?.stopCapturing()
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
      undoManagerRef.current?.stopCapturing()
      view.focus()
    },
    insertCitation: (citation) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current || !citation) return
      const { from, to } = view.state.selection.main
      const insertion = getCitationInsertion(
        view.state.doc.toString(),
        from,
        to,
        citation,
      )
      undoManagerRef.current?.stopCapturing()
      view.dispatch({
        changes: { from, to, insert: insertion.text },
        selection: { anchor: from + insertion.cursorOffset },
      })
      undoManagerRef.current?.stopCapturing()
      view.focus()
    },
    getCommentSelection: () => {
      const view = viewRef.current
      if (!view) return null
      const selection = view.state.selection.main
      const range = getCommentRange(
        view.state.doc.toString(),
        selection.from,
        selection.to,
      )
      return range.to > range.from ? { from: range.from, to: range.to } : null
    },
    revealRange: (from, to, focus = true) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
      if (focus) view.focus()
    },
    revealPosition: (position) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
      })
    },
    getScrollAnchor: () => viewRef.current
      ? getViewScrollAnchor(viewRef.current)
      : { position: null, progress: 0 },
    setScrollAnchor: (anchor) => {
      const view = viewRef.current
      if (!view) return
      expectedScrollProgressRef.current = setViewScrollAnchor(view, anchor)
    },
    focus: () => viewRef.current?.focus(),
  }))

  return (
    <div className={`collaborative-editor ${suggestionMode ? 'source-suggestion-mode' : ''}`}>
      <div className="collaborative-editor-host" ref={containerRef} />
      {suggestionMode && (
        <div className="source-suggestion-draft" role="status">
          <div>
            <strong>{draftDirty ? 'Saving suggestion...' : 'Suggesting'}</strong>
            <span>{draftError ?? 'Changes become attributed suggestions after you pause; accepted MyST changes only after individual approval.'}</span>
          </div>
        </div>
      )}
    </div>
  )
})

CollaborativeEditor.displayName = 'CollaborativeEditor'