import { redo, undo } from '@codemirror/commands'
import { snippet } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { getCommentRange } from '../lib/commentAnchors'
import { getCitationInsertion } from '../lib/citationInsertion'
import {
  fillSnippetSelection,
  mystAuthoringCompletionSource,
} from '../lib/mystAuthoring'

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
  readOnly?: boolean
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
  revealRange: (from: number, to: number) => void
  focus: () => void
}

interface ReviewDecorations {
  comments: CommentHighlight[]
  suggestions: SourceSuggestionHighlight[]
}

const setReviewDecorations = StateEffect.define<ReviewDecorations>()

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
          const insertion = suggestion.to > suggestion.from
            ? [Decoration.mark({
                class: [
                  'cm-suggestion-insertion',
                  suggestion.active ? 'is-active' : '',
                ].filter(Boolean).join(' '),
                attributes: {
                  'aria-label': `Suggested insertion by ${suggestion.authorName}. Press Enter to open review.`,
                  'data-comment-id': suggestion.id,
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
  '&': {
    height: '100%',
    background: '#fff',
    color: '#202723',
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
    caretColor: '#16705d',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    background: '#fff',
    border: 'none',
    color: '#68716c',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    background: '#f4f7f4',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    background: '#cfe7df',
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
    background: '#eaf7f1',
    color: '#185b49',
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
    background: '#eaf7f1',
    color: '#202723',
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
    color: '#185b49',
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
  readOnly = false,
  suggestionMode = false,
  suggestionHighlights = [],
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onCommentClickRef = useRef(onCommentClick)
  const readOnlyRef = useRef(readOnly)
  const readOnlyCompartmentRef = useRef(new Compartment())
  const pointerSelectionRef = useRef<{ from: number; to: number } | null>(null)

  useEffect(() => {
    onCommentClickRef.current = onCommentClick
  }, [onCommentClick])

  useEffect(() => {
    if (!containerRef.current) return

    const undoManager = new Y.UndoManager(sharedText)
    const state = EditorState.create({
      doc: sharedText.toString(),
      extensions: [
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
        yCollab(sharedText, provider.awareness, { undoManager }),
      ],
    })
    const view = new EditorView({ state, parent: containerRef.current })
    let pointerSelectionAnchor: number | null = null
    const beginPointerSelection = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointerSelectionRef.current = null
      pointerSelectionAnchor = view.posAtCoords({ x: event.clientX, y: event.clientY })
    }
    const finishPointerSelection = (event: PointerEvent) => {
      const anchor = pointerSelectionAnchor
      pointerSelectionAnchor = null
      if (anchor === null) return
      const head = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (head === null || head === anchor) return
      pointerSelectionRef.current = {
        from: Math.min(anchor, head),
        to: Math.max(anchor, head),
      }
      window.requestAnimationFrame(() => {
        view.dispatch({ selection: { anchor, head } })
      })
    }
    const clearPointerSelectionFromKeyboard = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        ['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)
      ) return
      pointerSelectionRef.current = null
    }
    const clearPointerSelection = () => {
      pointerSelectionRef.current = null
    }
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
    view.contentDOM.addEventListener('pointerdown', beginPointerSelection, true)
    window.addEventListener('pointerup', finishPointerSelection, true)
    view.contentDOM.addEventListener('keydown', clearPointerSelectionFromKeyboard, true)
    view.contentDOM.addEventListener('cut', clearPointerSelection)
    view.contentDOM.addEventListener('input', clearPointerSelection)
    view.contentDOM.addEventListener('paste', clearPointerSelection)
    view.dom.addEventListener('keydown', activateReviewFromKeyboard, true)
    viewRef.current = view

    return () => {
      view.contentDOM.removeEventListener('pointerdown', beginPointerSelection, true)
      window.removeEventListener('pointerup', finishPointerSelection, true)
      view.contentDOM.removeEventListener('keydown', clearPointerSelectionFromKeyboard, true)
      view.contentDOM.removeEventListener('cut', clearPointerSelection)
      view.contentDOM.removeEventListener('input', clearPointerSelection)
      view.contentDOM.removeEventListener('paste', clearPointerSelection)
      view.dom.removeEventListener('keydown', activateReviewFromKeyboard, true)
      view.destroy()
      undoManager.destroy()
      viewRef.current = null
    }
  }, [provider, sharedText])

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
        suggestions: suggestionHighlights,
      }),
    })
  }, [commentHighlights, suggestionHighlights])

  useImperativeHandle(ref, () => ({
    undo: () => {
      if (viewRef.current && !readOnlyRef.current) undo(viewRef.current)
    },
    redo: () => {
      if (viewRef.current && !readOnlyRef.current) redo(viewRef.current)
    },
    wrapSelection: (before, after = before) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current) return
      const { from, to } = pointerSelectionRef.current ?? view.state.selection.main
      pointerSelectionRef.current = null
      const selectedText = view.state.sliceDoc(from, to)
      view.dispatch({
        changes: { from, to, insert: `${before}${selectedText}${after}` },
        selection: { anchor: from + before.length, head: to + before.length },
      })
      view.focus()
    },
    insertSnippet: (template, selectedTextPlaceholder) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current) return
      const { from, to } = pointerSelectionRef.current ?? view.state.selection.main
      pointerSelectionRef.current = null
      const selectedText = view.state.sliceDoc(from, to)
      const resolvedTemplate = fillSnippetSelection(
        template,
        selectedTextPlaceholder,
        selectedText,
      )
      snippet(resolvedTemplate)(view, null, from, to)
      view.focus()
    },
    insertText: (text) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current || !text) return
      const { from, to } = pointerSelectionRef.current ?? view.state.selection.main
      pointerSelectionRef.current = null
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      })
      view.focus()
    },
    insertCitation: (citation) => {
      const view = viewRef.current
      if (!view || readOnlyRef.current || !citation) return
      const { from, to } = pointerSelectionRef.current ?? view.state.selection.main
      pointerSelectionRef.current = null
      const insertion = getCitationInsertion(
        view.state.doc.toString(),
        from,
        to,
        citation,
      )
      view.dispatch({
        changes: { from, to, insert: insertion.text },
        selection: { anchor: from + insertion.cursorOffset },
      })
      view.focus()
    },
    getCommentSelection: () => {
      const view = viewRef.current
      if (!view) return null
      const selection = pointerSelectionRef.current ?? view.state.selection.main
      const range = getCommentRange(
        view.state.doc.toString(),
        selection.from,
        selection.to,
      )
      return range.to > range.from ? { from: range.from, to: range.to } : null
    },
    revealRange: (from, to) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      })
      view.focus()
    },
    focus: () => viewRef.current?.focus(),
  }))

  return (
    <div className={`collaborative-editor ${suggestionMode ? 'source-suggestion-mode' : ''}`}>
      <div className="collaborative-editor-host" ref={containerRef} />
      {suggestionMode && (
        <div className="source-suggestion-draft" role="status">
          <div>
            <strong>Suggesting live</strong>
            <span>Source and Visual update for everyone in the room; accepted MyST changes only after a maintainer accepts the proposal.</span>
          </div>
        </div>
      )}
    </div>
  )
})

CollaborativeEditor.displayName = 'CollaborativeEditor'