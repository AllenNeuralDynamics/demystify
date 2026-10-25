import { AtSign, Check, Link2, MessageSquarePlus, X } from 'lucide-react'
import { baseKeymap, chainCommands, createParagraphNear, liftEmptyBlock, newlineInCode,
  splitBlockAs, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { splitListItem } from 'prosemirror-schema-list'
import { EditorState, NodeSelection, Plugin, TextSelection, type Command } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import katex from 'katex'
import { rebaseTextDraft, type CollaborativeTextEditResult } from '../lib/collaborativeTextEdit'
import { applyVisualSourceChanges } from '../lib/visualCollaboration'
import {
  createVisualDocument,
  serializeVisualBlock,
  serializeVisualDocument,
  sourcePositionToVisual,
  visualDocumentSchema,
  visualNodeSourceRange,
  visualPositionToSource,
  type VisualDocumentOptions,
} from '../lib/visualDocument'
import { safeVisualLinkTarget, visualCitationLabel } from '../lib/visualInline'
import { fillSnippetSelection } from '../lib/mystAuthoring'
import { renderMyst } from '../lib/myst'
import { getCitationInsertion } from '../lib/citationInsertion'
import { readVisualRecoveryDraft, visualObjectDraftKey, writeVisualRecoveryDraft,
  type VisualRecoveryDraft } from '../lib/collaborationRecovery'
import type { CommentHighlight } from './CollaborativeEditor'
import type { MystPreviewSuggestion } from './MystPreview'
import type { VisualCitationInserter } from './VisualInlineEditor'

export interface ContinuousVisualEditorHandle {
  undo: () => void
  redo: () => void
  wrapSelection: (marker: string) => void
  insertText: (text: string) => void
  insertSnippet: (template: string, selectedTextPlaceholder?: string) => void
  insertCitation: (citation: string) => void
  getCommentSelection: () => { from: number; to: number } | null
  revealRange: (from: number, to: number, focus?: boolean) => void
  focus: () => void
}

export interface ContinuousVisualOptions {
  draftKey: string
  active?: boolean
  toolbarHost?: HTMLElement | null
  sharedText: Y.Text
  provider: WebsocketProvider
  suggestionMode: boolean
  onProposeSourceEdit: (draft: string) => { result: CollaborativeTextEditResult; suggestionId?: string }
  onDraftChange: (draft: string | null) => void
  onReady: (handle: ContinuousVisualEditorHandle | null) => void
  onFocus?: () => void
}

interface ContinuousVisualEditorProps extends VisualDocumentOptions, ContinuousVisualOptions {
  content: string
  editable: boolean
  comments: CommentHighlight[]
  suggestions: MystPreviewSuggestion[]
  onCommentClick?: (id: string) => void
  onCommentSelection?: (range: { from: number; to: number }) => void
  onSuggestionClick?: (id: string) => void
  onEditError?: (message: string) => void
  onLayoutChange?: () => void
  onRequestCitation?: (insert: VisualCitationInserter) => void
}

interface VisualObjectEdit {
  host: HTMLElement | null
  kind: 'equation' | 'MyST object'
  prefix: string
  suffix: string
  value: string
  base: string
  suggestionMode: boolean
  recoveryKey: string
  anchor: string
  head: string
  position: number
  error?: string
  documentDraft: (source: string) => string | null
  apply: (source: string) => CollaborativeTextEditResult
  close: () => void
}

const objectSourceParts = (source: string) => {
  const equation = source.match(/^(\$\$(?:\r?\n)?)([\s\S]*?)((?:\r?\n)?\$\$[^\n]*)$/)
  return { kind: equation ? 'equation' as const : 'MyST object' as const,
    prefix: equation?.[1] ?? '', suffix: equation?.[3] ?? '', value: equation?.[2] ?? source }
}

export const ContinuousVisualEditor = (props: ContinuousVisualEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  const latestPropsRef = useRef(props)
  const effectKeyRef = useRef(props.draftKey)
  const draftModeRef = useRef<boolean | null>(null)
  const sourceRef = useRef(props.content)
  const baseRef = useRef(props.content)
  const pendingRef = useRef(false)
  const focusedReviewRef = useRef<{ commentId?: string; suggestionId?: string } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const refreshRef = useRef<(source: string, force?: boolean) => void>(() => {})
  const flushRef = useRef<() => void>(() => {})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backupUnavailable, setBackupUnavailable] = useState(false)
  const [linkUrl, setLinkUrl] = useState<string | null>(null)
  const [objectEdit, setObjectEdit] = useState<VisualObjectEdit | null>(null)
  const objectPanelRef = useRef<HTMLElement>(null)
  const objectSourceRef = useRef<HTMLTextAreaElement>(null)
  const objectEditRef = useRef<VisualObjectEdit | null>(null)
  const persistObjectRef = useRef<(edit: VisualObjectEdit | null) => void>(() => {})
  const finishObjectRef = useRef<(commit: boolean, focus?: boolean) => boolean>(() => true)
  const [selectionComment, setSelectionComment] = useState<{
    left: number; top: number; range: { from: number; to: number }
  } | null>(null)
  const renderOptionsRef = useRef({ bibliography: props.bibliography, assetBaseUrl: props.assetBaseUrl,
    projectFiles: props.projectFiles, sourcePath: props.sourcePath })

  useLayoutEffect(() => {
    latestPropsRef.current = props
    if (effectKeyRef.current === props.draftKey) propsRef.current = props
    persistObjectRef.current = (edit) => {
      objectEditRef.current = edit
      const source = edit ? `${edit.prefix}${edit.value}${edit.suffix}` : ''
      const dirty = edit !== null && source !== edit.base
      const available = edit ? writeVisualRecoveryDraft(edit.recoveryKey, dirty ? {
        base: edit.base, source, suggestionMode: edit.suggestionMode,
        object: { anchor: edit.anchor, head: edit.head, position: edit.position },
      } : null) : true
      if (dirty) {
        setBackupUnavailable(!available)
        propsRef.current.onDraftChange(edit.documentDraft(source) ?? source)
      } else {
        if (!pendingRef.current) setBackupUnavailable(false)
        propsRef.current.onDraftChange(pendingRef.current ? sourceRef.current : null)
      }
    }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const initial = latestPropsRef.current
    effectKeyRef.current = initial.draftKey
    propsRef.current = initial
    const { sharedText, provider, draftKey } = initial
    const finishOutsideObject = (event: Event) => {
      const edit = objectEditRef.current
      const target = event.target
      if (!edit || !(target instanceof Node) || objectPanelRef.current?.contains(target) ||
        edit.host?.parentElement?.contains(target)) return
      if (event instanceof MouseEvent && event.button !== 0) return
      finishObjectRef.current(true, false)
    }
    window.document.addEventListener('click', finishOutsideObject, true)
    const objectKey = visualObjectDraftKey(draftKey)
    const cachedObject = readVisualRecoveryDraft(objectKey)
    const objectOpeners = new Set<{ source: () => string; position: () => number | undefined;
      begin: (cached?: VisualRecoveryDraft) => void }>()
    const cached = readVisualRecoveryDraft(draftKey)
    const restored = cached ? rebaseTextDraft(cached.base, cached.source, initial.content) : null
    const initialSource = cached ? restored ?? cached.source : initial.content
    sourceRef.current = initialSource
    baseRef.current = cached && restored === null ? cached.base : initial.content
    pendingRef.current = Boolean(cached && cached.source !== cached.base)
    draftModeRef.current = pendingRef.current ? cached!.suggestionMode : null
    setPending(pendingRef.current)
    setError(cached && restored === null ? 'Recovered draft overlaps shared changes. Your draft has been retained.' : null)
    const persistPending = () => {
      const available = writeVisualRecoveryDraft(draftKey, pendingRef.current ? {
        base: baseRef.current, source: sourceRef.current,
        suggestionMode: draftModeRef.current ?? propsRef.current.suggestionMode,
      } : null)
      setBackupUnavailable(pendingRef.current && !available)
      propsRef.current.onDraftChange(pendingRef.current ? sourceRef.current : null)
      if (objectEditRef.current) persistObjectRef.current(objectEditRef.current)
    }
    const origin = {}
    const undoManager = new Y.UndoManager(sharedText, { trackedOrigins: new Set([origin]) })
    let relativeSelection: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null = null
    let destroyed = false

    const sourceSelection = () => {
      const view = viewRef.current
      return view ? {
        from: visualPositionToSource(view.state.doc, view.state.selection.from),
        to: visualPositionToSource(view.state.doc, view.state.selection.to),
      } : null
    }

    const rememberSelection = () => {
      const view = viewRef.current
      if (!view) return
      const from = visualPositionToSource(view.state.doc, view.state.selection.anchor)
      const to = visualPositionToSource(view.state.doc, view.state.selection.head)
      if (!propsRef.current.suggestionMode && from <= sharedText.length && to <= sharedText.length) {
        relativeSelection = {
          anchor: Y.createRelativePositionFromTypeIndex(sharedText, from),
          head: Y.createRelativePositionFromTypeIndex(sharedText, to),
        }
        if (view.hasFocus()) provider.awareness.setLocalStateField('cursor', {
          anchor: Y.relativePositionToJSON(relativeSelection.anchor),
          head: Y.relativePositionToJSON(relativeSelection.head),
        })
      }
      const selected = view.state.selection
      if (!selected.empty && propsRef.current.onCommentSelection && view.hasFocus()) {
        const rect = view.coordsAtPos(selected.to)
        const range = sourceSelection()
        if (range) setSelectionComment({
          left: Math.max(56, Math.min(window.innerWidth - 56, rect.left)),
          top: Math.max(8, Math.min(window.innerHeight - 42, rect.bottom + 6)), range,
        })
      } else setSelectionComment(null)
    }

    const decorations = (state: EditorState) => {
      const current = propsRef.current
      const result: Decoration[] = []
      state.doc.descendants((node, position) => {
        if (!node.isTextblock) return
        result.push(Decoration.node(position, position + node.nodeSize, {
          class: 'myst-editable-block',
          'data-myst-source-from': String(visualPositionToSource(state.doc, position + 1)),
          'data-myst-source-to': String(visualPositionToSource(state.doc, position + node.nodeSize - 1)),
        }))
      })
      for (const comment of current.comments) {
        if (comment.resolved) continue
        const from = sourcePositionToVisual(state.doc, comment.from)
        const to = sourcePositionToVisual(state.doc, comment.to, -1)
        if (to <= from) continue
        result.push(Decoration.inline(from, to, {
          class: `myst-comment-highlight${comment.active ? ' is-active' : ''}`,
          'data-myst-comment-id': comment.id,
          role: 'button', tabindex: '0',
          'aria-label': `Open comment on ${sourceRef.current.slice(comment.from, comment.to).trim() || 'selection'}`,
        }))
      }
      for (const suggestion of current.suggestions) {
        const from = sourcePositionToVisual(state.doc, suggestion.from)
        const to = sourcePositionToVisual(state.doc, suggestion.to, -1)
        const inlineProposal = current.suggestionMode || suggestion.projection === 'working'
        const reviewStyle = document.createElement('span').style
        reviewStyle.setProperty('--myst-suggestion-color', suggestion.authorColor)
        const attributes = {
          class: inlineProposal ? `myst-suggestion-option${suggestion.active ? ' is-active' : ''}` : '',
          'data-myst-suggestion-id': suggestion.id,
          style: reviewStyle.cssText,
          role: 'button', tabindex: '0',
          'aria-label': `Suggested edit by ${suggestion.authorName}. Open review discussion.`,
        }
        if (to > from) result.push(Decoration.inline(from, to, {
          ...attributes,
          class: `${attributes.class} ${inlineProposal
            ? 'myst-suggestion-insertion' : 'myst-suggestion-deletion'}`,
        }))
        if (!current.suggestionMode && suggestion.projection !== 'working' && suggestion.after) {
          result.push(Decoration.widget(to, () => {
            const element = document.createElement('span')
            element.className = `myst-suggestion-option myst-suggestion-insertion${suggestion.active ? ' is-active' : ''}`
            element.dataset.mystSuggestionId = suggestion.id
            element.style.setProperty('--myst-suggestion-color', suggestion.authorColor)
            element.contentEditable = 'false'
            element.tabIndex = 0
            element.setAttribute('role', element.classList.contains('is-object-editing') ? 'group' : 'button')
            element.setAttribute('aria-label', `Suggested edit by ${suggestion.authorName}`)
            element.textContent = ` ${suggestion.after}`
            const author = document.createElement('span')
            author.className = 'myst-suggestion-author'
            author.textContent = suggestion.authorName
            element.append(author)
            return element
          }, { key: `${suggestion.id}:${suggestion.after}:${suggestion.active}` }))
        }
      }
      if (state.doc.attrs.appendixHtml) result.push(Decoration.widget(state.doc.content.size, () => {
        const element = document.createElement('div')
        element.className = 'visual-readonly-appendix'
        element.contentEditable = 'false'
        element.innerHTML = state.doc.attrs.appendixHtml
        return element
      }, { key: state.doc.attrs.appendixHtml }))
      if (!current.suggestionMode && sharedText.doc) provider.awareness.getStates().forEach((remote, clientId) => {
        if (clientId === provider.awareness.clientID || !remote.cursor?.anchor || !remote.cursor?.head) return
        let anchor: Y.AbsolutePosition | null
        let head: Y.AbsolutePosition | null
        try {
          anchor = Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(remote.cursor.anchor), sharedText.doc!)
          head = Y.createAbsolutePositionFromRelativePosition(
            Y.createRelativePositionFromJSON(remote.cursor.head), sharedText.doc!)
        } catch { return }
        if (!anchor || !head || anchor.type !== sharedText || head.type !== sharedText) return
        const from = sourcePositionToVisual(state.doc, Math.min(anchor.index, head.index))
        const to = sourcePositionToVisual(state.doc, Math.max(anchor.index, head.index), -1)
        const color = remote.user?.color ?? '#1a73e8'
        const name = remote.user?.name ?? 'Collaborator'
        if (to > from) {
          const style = document.createElement('span').style
          style.backgroundColor = remote.user?.colorLight ?? '#d3e3fd'
          result.push(Decoration.inline(from, to, { class: 'visual-remote-selection', style: style.cssText }))
        }
        const cursorPosition = sourcePositionToVisual(state.doc, head.index)
        result.push(Decoration.widget(cursorPosition, () => {
          const cursor = document.createElement('span')
          cursor.className = 'visual-remote-caret'
          cursor.contentEditable = 'false'
          cursor.dataset.user = name
          cursor.setAttribute('aria-label', `Cursor of ${name}`)
          cursor.style.borderColor = color
          return cursor
        }, { key: `${clientId}:${name}:${color}`, side: 1 }))
      })
      return DecorationSet.create(state.doc, result)
    }

    const createObjectOpener = (element: HTMLElement, host: HTMLElement,
      getPosition: () => number | undefined) => {
      const current = () => {
        const position = getPosition()
        if (position === undefined) return null
        const node = view.state.doc.nodeAt(position)
        const range = visualNodeSourceRange(view.state.doc, position)
        return node && range ? { node, range, position, source: serializeVisualBlock(node) } : null
      }
      const begin = (recovery?: VisualRecoveryDraft) => {
        if (!propsRef.current.editable || objectEditRef.current) return
        const initial = current()
        if (!initial) return
        propsRef.current.onFocus?.()
        setSelectionComment(null)
        const { source, range, position } = initial
        const anchored = sourceRef.current === sharedText.toString() && range.to <= sharedText.length
        const anchor = recovery?.object?.anchor ?? (anchored ? JSON.stringify(Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(sharedText, range.from, 1))) : '')
        const head = recovery?.object?.head ?? (anchored ? JSON.stringify(Y.relativePositionToJSON(
          Y.createRelativePositionFromTypeIndex(sharedText, range.to, -1))) : '')
        const matchesAnchor = () => {
          if (!anchor || !head || !sharedText.doc) return true
          try {
            const start = Y.createAbsolutePositionFromRelativePosition(
              Y.createRelativePositionFromJSON(JSON.parse(anchor)), sharedText.doc)
            const end = Y.createAbsolutePositionFromRelativePosition(
              Y.createRelativePositionFromJSON(JSON.parse(head)), sharedText.doc)
            const latest = current()
            return Boolean(start && end && latest && start.type === sharedText && end.type === sharedText &&
              end.index > start.index && start.index === latest.range.from && end.index === latest.range.to)
          } catch { return false }
        }
        const height = Math.max(96, Math.ceil(element.getBoundingClientRect().height))
        element.style.setProperty('--visual-object-height', `${height}px`)
        element.classList.add('is-object-editing')
        host.hidden = false
        if (initial.node.isAtom) element.setAttribute('role', 'group')
        const edit: VisualObjectEdit = {
          host, ...objectSourceParts(recovery?.source ?? source), base: recovery?.base ?? source,
          suggestionMode: recovery?.suggestionMode ?? propsRef.current.suggestionMode,
          recoveryKey: objectKey, anchor, head, position,
          documentDraft: (draft) => {
            const latest = current()
            if (!latest || latest.node.type !== initial.node.type) return null
            return sourceRef.current.slice(0, latest.range.from) + draft + sourceRef.current.slice(latest.range.to)
          },
          close: () => {
            element.classList.remove('is-object-editing')
            element.style.removeProperty('--visual-object-height')
            host.hidden = true
            if (initial.node.isAtom) element.setAttribute('role', 'button')
          },
          apply: (draft) => {
            if (!propsRef.current.editable || edit.suggestionMode !== propsRef.current.suggestionMode) return 'unavailable'
            const latest = current()
            if (!latest || latest.node.type !== initial.node.type) return 'unavailable'
            if (!matchesAnchor()) return 'conflict'
            const rebased = rebaseTextDraft(edit.base, draft, latest.source)
            if (rebased === null) return 'conflict'
            const rendered = renderMyst(rebased, propsRef.current)
            if (rendered.error) return 'unavailable'
            let transaction = view.state.tr
            if (latest.node.isAtom) {
              transaction = transaction.setNodeMarkup(latest.position, undefined, {
                ...latest.node.attrs, source: rebased, html: rendered.html,
              })
            } else {
              const replacement = createVisualDocument(rebased, propsRef.current)
              const node = replacement.firstChild
              if (!node || replacement.childCount !== 1 || node.type !== latest.node.type) return 'unavailable'
              transaction = transaction.replaceWith(latest.position, latest.position + latest.node.nodeSize,
                node.type.create({ ...node.attrs, before: latest.node.attrs.before }, node.content))
            }
            undoManager.stopCapturing()
            view.dispatch(transaction)
            undoManager.stopCapturing()
            return 'applied'
          },
        }
        persistObjectRef.current(edit)
        setObjectEdit(edit)
      }
      return { source: () => current()?.source ?? '', position: getPosition, begin }
    }

    const undoCommand: Command = (state, dispatch) => {
      if (propsRef.current.suggestionMode) return undo(state, dispatch)
      undoManager.undo()
      return true
    }
    const redoCommand: Command = (state, dispatch) => {
      if (propsRef.current.suggestionMode) return redo(state, dispatch)
      undoManager.redo()
      return true
    }
    const split = splitBlockAs((node, atEnd) => ({
      type: node.type.name === 'heading' && !atEnd ? visualDocumentSchema.nodes.heading
        : visualDocumentSchema.nodes.paragraph,
      attrs: node.type.name === 'heading' && !atEnd ? { level: node.attrs.level } : undefined,
    }))
    const splitList: Command = (state, dispatch) => splitListItem(visualDocumentSchema.nodes.list_item)(
      state, dispatch ? (transaction) => {
        transaction.doc.descendants((node, position) => {
          if (node.type.name !== 'list_item' || node.attrs.original !== null || !node.firstChild) return
          transaction.setNodeMarkup(position + 1, undefined, { ...node.firstChild.attrs, before: '' })
        })
        dispatch(transaction)
      } : undefined,
    )
    const view = new EditorView(container, {
      state: EditorState.create({
        doc: createVisualDocument(initialSource, propsRef.current),
        plugins: [history(), keymap({
          'Mod-b': toggleMark(visualDocumentSchema.marks.strong),
          'Mod-i': toggleMark(visualDocumentSchema.marks.emphasis),
          'Mod-`': toggleMark(visualDocumentSchema.marks.code),
          'Mod-z': undoCommand, 'Mod-y': redoCommand, 'Mod-Shift-z': redoCommand,
          Enter: chainCommands(newlineInCode, splitList, createParagraphNear, liftEmptyBlock, split),
          'Shift-Enter': (state, dispatch) => {
            dispatch?.(state.tr.replaceSelectionWith(visualDocumentSchema.nodes.hard_break.create()).scrollIntoView())
            return true
          },
        }), keymap(baseKeymap), new Plugin({ props: { decorations } })],
      }),
      attributes: { class: 'myst-preview continuous-visual-document', role: 'textbox',
        'data-visual-draft-key': draftKey,
        'aria-label': 'Formatted manuscript', 'aria-multiline': 'true', spellcheck: 'true' },
      editable: () => propsRef.current.editable && (draftModeRef.current === null ||
        draftModeRef.current === propsRef.current.suggestionMode),
      nodeViews: {
        myst_container: (node, _view, getPosition) => {
          const template = document.createElement('template')
          template.innerHTML = node.attrs.html
          const shell = template.content.firstElementChild
          const dom = shell instanceof HTMLElement ? shell.cloneNode(false) as HTMLElement
            : document.createElement('div')
          const contentDOM = document.createElement('div')
          contentDOM.className = 'visual-container-content'
          if (shell?.tagName === 'FIGURE') {
            for (const child of Array.from(shell.childNodes)) {
              if (child instanceof HTMLElement && child.tagName === 'FIGCAPTION') continue
              const copy = child.cloneNode(true)
              if (copy instanceof HTMLElement) copy.contentEditable = 'false'
              dom.append(copy)
            }
            const caption = document.createElement('figcaption')
            const number = shell.querySelector('.caption-number')?.cloneNode(true)
            if (number) caption.append(number, document.createTextNode(' '))
            caption.append(contentDOM)
            dom.append(caption)
          } else {
            const label = shell?.querySelector(':scope > summary, :scope > .admonition-title')?.cloneNode(true)
            if (label instanceof HTMLElement) { label.contentEditable = 'false'; dom.append(label) }
            dom.append(contentDOM)
          }
          const toggled = () => propsRef.current.onLayoutChange?.()
          dom.addEventListener('toggle', toggled)
          const image = dom.tagName === 'FIGURE' ? dom.querySelector('img') : null
          const host = document.createElement('div')
          host.className = 'visual-object-editor-host'
          host.contentEditable = 'false'
          host.hidden = true
          if (image) dom.append(host)
          const figureOpener = createObjectOpener(dom, host, getPosition)
          const imageClick = () => figureOpener.begin()
          const imageMouseDown = (event: MouseEvent) => event.preventDefault()
          const imageKeydown = (event: KeyboardEvent) => {
            if (!['Enter', ' ', 'F2'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            figureOpener.begin()
          }
          if (image) {
            image.tabIndex = 0
            image.setAttribute('role', 'button')
            image.setAttribute('aria-label', 'Edit figure')
            image.title = 'Edit figure'
            image.addEventListener('click', imageClick)
            image.addEventListener('mousedown', imageMouseDown)
            image.addEventListener('keydown', imageKeydown)
            objectOpeners.add(figureOpener)
          }
          return { dom, contentDOM,
            stopEvent: (event) => event.target instanceof Element &&
              (host.contains(event.target) || Boolean(event.target.closest('summary, img[role="button"]'))),
            ignoreMutation: (mutation) => mutation.type !== 'selection' &&
              !contentDOM.contains(mutation.target),
            destroy: () => {
              dom.removeEventListener('toggle', toggled)
              image?.removeEventListener('click', imageClick)
              image?.removeEventListener('mousedown', imageMouseDown)
              image?.removeEventListener('keydown', imageKeydown)
              objectOpeners.delete(figureOpener)
              const current = objectEditRef.current
              if (!destroyed && current?.host === host) {
                const detached = { ...current, host: null, error: 'This object was removed. Your draft is retained.' }
                persistObjectRef.current(detached)
                setObjectEdit(detached)
              }
            },
            update: (next) => {
            if (next.type !== node.type || next.attrs.prefix !== node.attrs.prefix || next.attrs.suffix !== node.attrs.suffix) return false
            if (dom.tagName === 'FIGURE') {
              const updated = document.createElement('template')
              updated.innerHTML = next.attrs.html
              const label = dom.querySelector('.caption-number')
              if (label) label.textContent = updated.content.querySelector('.caption-number')?.textContent ?? ''
            }
            return true
          } }
        },
        protected_block: (node, _view, getPosition) => {
          let currentNode = node
          const element = document.createElement('div')
          element.className = 'visual-protected-block'
          element.contentEditable = 'false'
          element.tabIndex = 0
          const preview = document.createElement('div')
          const host = document.createElement('div')
          host.className = 'visual-object-editor-host'
          host.contentEditable = 'false'
          host.hidden = true
          element.append(preview, host)
          const render = () => {
            preview.innerHTML = currentNode.attrs.html
            element.hidden = !String(currentNode.attrs.html).trim()
            element.setAttribute('role', element.classList.contains('is-object-editing') ? 'group' : 'button')
            element.setAttribute('aria-label', String(currentNode.attrs.source).startsWith('$$')
              ? 'Edit equation' : 'Edit MyST object')
            element.title = 'Click or press Enter to edit this object'
            for (const math of Array.from(preview.querySelectorAll<HTMLElement>('.math-display, .math-inline'))) {
              katex.render(math.textContent ?? '', math, { displayMode: math.classList.contains('math-display'),
                throwOnError: false, strict: 'ignore' })
            }
          }
          render()
          const objectOpener = createObjectOpener(element, host, getPosition)
          objectOpeners.add(objectOpener)
          const doubleClick = () => objectOpener.begin()
          const click = (event: MouseEvent) => {
            if (event.target instanceof Element && event.target.closest('a, summary, button, input, textarea, select')) return
            if (window.getSelection()?.isCollapsed === false && !(view.state.selection instanceof NodeSelection)) return
            objectOpener.begin()
          }
          const keydown = (event: KeyboardEvent) => {
            if (event.target !== element || !['Enter', ' ', 'F2'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            objectOpener.begin()
          }
          element.addEventListener('dblclick', doubleClick)
          element.addEventListener('click', click)
          element.addEventListener('keydown', keydown)
          return { dom: element, ignoreMutation: () => true,
            stopEvent: (event) => event.target instanceof Element &&
              (event.type === 'dblclick' || event.target === element ||
                Boolean(event.target.closest('summary, button, input, select, textarea, a'))),
            update: (next) => {
              if (next.type !== node.type) return false
              currentNode = next
              render()
              return true
            },
            destroy: () => {
              element.removeEventListener('dblclick', doubleClick)
              element.removeEventListener('click', click)
              element.removeEventListener('keydown', keydown)
              objectOpeners.delete(objectOpener)
              const current = objectEditRef.current
              if (!destroyed && current?.host === host) {
                const detached = { ...current, host: null, error: 'This object was removed. Your draft is retained.' }
                persistObjectRef.current(detached)
                setObjectEdit(detached)
              }
            },
          }
        },
      },
      handleClick: (_view, _position, event) => {
        const target = event.target instanceof Element ? event.target : null
        const selection = window.getSelection()
        if (selection && !selection.isCollapsed) return false
        const comment = target?.closest<HTMLElement>('[data-myst-comment-id]')
        const suggestion = target?.closest<HTMLElement>('[data-myst-suggestion-id]')
        if (comment?.dataset.mystCommentId) propsRef.current.onCommentClick?.(comment.dataset.mystCommentId)
        else if (suggestion?.dataset.mystSuggestionId) propsRef.current.onSuggestionClick?.(suggestion.dataset.mystSuggestionId)
        else return false
        return true
      },
      handleDOMEvents: {
        focus: () => { propsRef.current.onFocus?.(); rememberSelection(); return false },
        mouseup: () => { queueMicrotask(rememberSelection); return false },
        keydown: (_view, event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return false
          const target = event.target instanceof HTMLElement ? event.target : null
          if (!target || target.getAttribute('role') !== 'button') return false
          const commentId = target.dataset.mystCommentId
          const suggestionId = target.dataset.mystSuggestionId
          if (commentId) propsRef.current.onCommentClick?.(commentId)
          else if (suggestionId) propsRef.current.onSuggestionClick?.(suggestionId)
          else return false
          event.preventDefault()
          return true
        },
      },
      dispatchTransaction: (transaction) => {
        const previous = sourceRef.current
        const next = view.state.apply(transaction)
        if (transaction.selectionSet && !transaction.docChanged && !transaction.getMeta('remote')) {
          undoManager.stopCapturing()
        }
        if (transaction.docChanged && !transaction.getMeta('remote')) {
          if (!propsRef.current.editable || (pendingRef.current && draftModeRef.current !== propsRef.current.suggestionMode)) return
          const source = serializeVisualDocument(next.doc)
          if (propsRef.current.suggestionMode) {
            sourceRef.current = source
            pendingRef.current = source !== baseRef.current
            draftModeRef.current = pendingRef.current ? true : null
            setPending(pendingRef.current)
            persistPending()
            if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
            saveTimerRef.current = window.setTimeout(() => flushRef.current(), 450)
          } else {
            sourceRef.current = source
            if (!applyVisualSourceChanges(sharedText, previous, source, origin)) {
              baseRef.current = previous
              pendingRef.current = true
              draftModeRef.current = false
              setPending(true)
              persistPending()
              setError('The shared text changed before this edit could be applied. Your local draft has been retained.')
              view.updateState(next)
              rememberSelection()
              return
            }
            baseRef.current = source
          }
          setError(null)
        }
        view.updateState(next)
        rememberSelection()
        propsRef.current.onLayoutChange?.()
      },
    })
    viewRef.current = view
    if (cachedObject?.object) {
      const candidates = Array.from(objectOpeners).filter((entry) => entry.source() === cachedObject.base)
      const candidate = candidates.length === 1 ? candidates[0]
        : candidates.find((entry) => entry.position() === cachedObject.object!.position)
      if (candidate && propsRef.current.editable) candidate.begin(cachedObject)
      else {
        const recovered: VisualObjectEdit = {
          host: null, ...objectSourceParts(cachedObject.source), base: cachedObject.base,
          recoveryKey: objectKey, suggestionMode: cachedObject.suggestionMode, ...cachedObject.object,
          error: 'Recovered object draft could not be reopened. Your draft is retained.',
          apply: () => 'unavailable', close: () => {}, documentDraft: () => null,
        }
        persistObjectRef.current(recovered)
        setObjectEdit(recovered)
      }
    }

    let sourceRefreshTimer: number | null = null
    let queuedSource: string | null = null
    refreshRef.current = (source, force = false) => {
      if (destroyed || propsRef.current.active === false || (!force && source === sourceRef.current)) return
      if (!force && queuedSource === source) return
      if (force && sourceRefreshTimer !== null) {
        window.clearTimeout(sourceRefreshTimer)
        sourceRefreshTimer = null
        queuedSource = null
      }
      const nextDocument = createVisualDocument(source, propsRef.current)
      const currentSelection = sourceSelection()
      let anchor = currentSelection?.from ?? 0
      let head = currentSelection?.to ?? anchor
      if (!propsRef.current.suggestionMode && relativeSelection && sharedText.doc) {
        anchor = Y.createAbsolutePositionFromRelativePosition(relativeSelection.anchor, sharedText.doc)?.index ?? anchor
        head = Y.createAbsolutePositionFromRelativePosition(relativeSelection.head, sharedText.doc)?.index ?? head
      }
      const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, nextDocument.content)
        .setDocAttribute('trailing', nextDocument.attrs.trailing)
        .setDocAttribute('appendixHtml', nextDocument.attrs.appendixHtml)
        .setMeta('remote', true).setMeta('addToHistory', false)
      const from = sourcePositionToVisual(transaction.doc, anchor)
      const to = sourcePositionToVisual(transaction.doc, head)
      transaction.setSelection(TextSelection.between(transaction.doc.resolve(from), transaction.doc.resolve(to)))
      sourceRef.current = source
      view.dispatch(transaction)
    }
    const flushSourceRefresh = () => {
      if (sourceRefreshTimer !== null) window.clearTimeout(sourceRefreshTimer)
      sourceRefreshTimer = null
      const source = queuedSource
      queuedSource = null
      if (source !== null) refreshRef.current(source)
    }
    const flushOnSourceExit = (event: Event) => {
      if (queuedSource !== null && event.target instanceof Element && !event.target.closest('.cm-content')) {
        flushSourceRefresh()
      }
    }
    window.document.addEventListener('pointerdown', flushOnSourceExit, true)
    window.document.addEventListener('focusin', flushOnSourceExit, true)
    view.dom.addEventListener('pointerdown', flushSourceRefresh, true)
    view.dom.addEventListener('focus', flushSourceRefresh, true)
    flushRef.current = () => {
      if (!pendingRef.current || !propsRef.current.editable) return
      if (draftModeRef.current !== propsRef.current.suggestionMode) {
        setError('Recovered draft belongs to a different editing mode. Your draft remains available for recovery.')
        return
      }
      const result = propsRef.current.suggestionMode
        ? propsRef.current.onProposeSourceEdit(sourceRef.current)
        : (() => {
            const canonical = sharedText.toString()
            const rebased = rebaseTextDraft(baseRef.current, sourceRef.current, canonical)
            if (rebased === null) return { result: 'conflict' as const }
            if (!applyVisualSourceChanges(sharedText, canonical, rebased, origin)) return { result: 'conflict' as const }
            refreshRef.current(rebased)
            return { result: 'applied' as const }
          })()
      if (result.result !== 'applied') {
        const message = result.result === 'conflict'
          ? 'Another edit overlaps this suggestion. Your draft is retained; retry after reviewing the shared changes.'
          : 'Suggestion saving is unavailable. Your draft is retained.'
        setError(message)
        propsRef.current.onEditError?.(message)
        return
      }
      baseRef.current = sourceRef.current
      pendingRef.current = false
      draftModeRef.current = null
      setPending(false)
      setError(null)
      persistPending()
    }
    const observe = (event: Y.YTextEvent) => {
      if (event.transaction.origin === origin || propsRef.current.suggestionMode || pendingRef.current) return
      const source = sharedText.toString()
      if (event.transaction.local && propsRef.current.active !== false &&
        window.document.activeElement?.closest('.cm-content')) {
        if (sourceRefreshTimer !== null) window.clearTimeout(sourceRefreshTimer)
        queuedSource = source
        sourceRefreshTimer = window.setTimeout(flushSourceRefresh, 150)
      } else {
        if (sourceRefreshTimer !== null) window.clearTimeout(sourceRefreshTimer)
        sourceRefreshTimer = null
        queuedSource = null
        refreshRef.current(source)
      }
      baseRef.current = source
    }
    sharedText.observe(observe)
    persistPending()
    if (pendingRef.current && restored !== null) saveTimerRef.current = window.setTimeout(() => flushRef.current(), 450)
    const refreshPresence = () => {
      if (propsRef.current.active !== false) view.updateState(view.state)
    }
    provider.awareness.on('change', refreshPresence)
    const run = (command: Command) => { command(view.state, view.dispatch, view); view.focus() }
    const insertMyst = (replacement: string, cursorOffset = replacement.length,
      target?: { from: number; to: number }) => {
      const range = target ?? sourceSelection()
      if (!range) return
      const source = sourceRef.current
      const nextSource = source.slice(0, range.from) + replacement + source.slice(range.to)
      const document = createVisualDocument(nextSource, propsRef.current)
      const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, document.content)
        .setDocAttribute('trailing', document.attrs.trailing)
        .setDocAttribute('appendixHtml', document.attrs.appendixHtml)
      const position = sourcePositionToVisual(transaction.doc, range.from + cursorOffset)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(position)))
      undoManager.stopCapturing()
      view.dispatch(transaction.scrollIntoView())
      undoManager.stopCapturing()
      view.focus()
    }
    propsRef.current.onReady({
      undo: () => run(undoCommand), redo: () => run(redoCommand),
      wrapSelection: (marker) => {
        undoManager.stopCapturing()
        run(toggleMark(visualDocumentSchema.marks[
          marker === '**' ? 'strong' : marker === '*' ? 'emphasis' : 'code']))
        undoManager.stopCapturing()
      },
      insertText: (text) => { view.dispatch(view.state.tr.insertText(text).scrollIntoView()); view.focus() },
      insertSnippet: (template, placeholder) => {
        const range = sourceSelection()
        if (!range) return
        const selected = sourceRef.current.slice(range.from, range.to)
        const resolved = fillSnippetSelection(template, placeholder, selected)
          .replace(/\$\{(?:\d+:)?([^}]*)\}/g, (_match, field: string) => /^\d+$/.test(field) ? '' : field)
        if (resolved.includes('\n') || /^#{1,6}\s/.test(resolved)) {
          const index = view.state.selection.$from.index(0)
          let afterBlock = 0
          view.state.doc.forEach((node, _position, nodeIndex) => {
            if (nodeIndex <= index) afterBlock += String(node.attrs.before).length + serializeVisualBlock(node).length
          })
          const source = sourceRef.current
          const before = source.slice(0, afterBlock)
          const after = source.slice(afterBlock)
          const leading = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
          const trailing = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
          const block = `${leading}${resolved.trim()}${trailing}`
          insertMyst(block, leading.length + resolved.trim().length, { from: afterBlock, to: afterBlock })
        } else insertMyst(resolved)
      },
      insertCitation: (citation) => {
        const range = sourceSelection()
        if (!range) return
        const insertion = getCitationInsertion(sourceRef.current, range.from, range.to, citation)
        insertMyst(insertion.text, insertion.cursorOffset)
      },
      getCommentSelection: () => {
        flushSourceRefresh()
        if (!view.state.selection.empty) return sourceSelection()
        const cursor = view.state.selection.$from
        if (!cursor.parent.isTextblock) return null
        return { from: visualPositionToSource(view.state.doc, cursor.start()),
          to: visualPositionToSource(view.state.doc, cursor.end()) }
      },
      revealRange: (from, to, focus = false) => {
        flushSourceRefresh()
        const start = sourcePositionToVisual(view.state.doc, from)
        const end = sourcePositionToVisual(view.state.doc, to, -1)
        view.dispatch(view.state.tr.setSelection(TextSelection.between(
          view.state.doc.resolve(start), view.state.doc.resolve(end))).scrollIntoView())
        if (focus) view.focus()
      },
      focus: () => view.focus(),
    })
    return () => {
      if (pendingRef.current) flushRef.current()
      destroyed = true
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (sourceRefreshTimer !== null) window.clearTimeout(sourceRefreshTimer)
      window.document.removeEventListener('pointerdown', flushOnSourceExit, true)
      window.document.removeEventListener('focusin', flushOnSourceExit, true)
      view.dom.removeEventListener('pointerdown', flushSourceRefresh, true)
      view.dom.removeEventListener('focus', flushSourceRefresh, true)
      sharedText.unobserve(observe)
      provider.awareness.off('change', refreshPresence)
      undoManager.destroy()
      view.destroy()
      window.document.removeEventListener('click', finishOutsideObject, true)
      viewRef.current = null
      objectEditRef.current = null
      setObjectEdit(null)
      propsRef.current.onReady(null)
    }
  }, [props.sharedText, props.provider, props.draftKey])

  useEffect(() => {
    const view = viewRef.current
    if (!view || props.active === false) return
    const previousOptions = renderOptionsRef.current
    const projectFilesChanged = previousOptions.projectFiles !== props.projectFiles &&
      (Object.keys(previousOptions.projectFiles ?? {}).length !== Object.keys(props.projectFiles ?? {}).length ||
        Object.entries(previousOptions.projectFiles ?? {}).some(([path, content]) => props.projectFiles?.[path] !== content))
    const force = previousOptions.bibliography !== props.bibliography || previousOptions.assetBaseUrl !== props.assetBaseUrl ||
      projectFilesChanged || previousOptions.sourcePath !== props.sourcePath
    renderOptionsRef.current = { bibliography: props.bibliography, assetBaseUrl: props.assetBaseUrl,
      projectFiles: props.projectFiles, sourcePath: props.sourcePath }
    view.setProps({ editable: () => propsRef.current.editable && (draftModeRef.current === null ||
      draftModeRef.current === propsRef.current.suggestionMode) })
    let source = props.content
    if (pendingRef.current && draftModeRef.current !== props.suggestionMode) {
      setError('Recovered draft belongs to a different editing mode. Your draft remains available for recovery.')
      return
    }
    if (pendingRef.current) {
      if (source === baseRef.current) { refreshRef.current(sourceRef.current, force); view.updateState(view.state); return }
      const rebased = rebaseTextDraft(baseRef.current, sourceRef.current, source)
      if (rebased === null) {
        setError('Another edit overlaps your pending suggestion. Your draft is retained.')
        return
      }
      baseRef.current = source
      source = rebased
    } else if (!pendingRef.current) baseRef.current = source
    refreshRef.current(source, force)
    if (pendingRef.current) writeVisualRecoveryDraft(props.draftKey, {
      base: baseRef.current, source: sourceRef.current, suggestionMode: draftModeRef.current!,
    })
    view.updateState(view.state)
  }, [props.active, props.content, props.editable, props.suggestionMode, props.comments, props.suggestions, props.draftKey,
    props.bibliography, props.assetBaseUrl, props.projectFiles, props.sourcePath])

  const run = (command: Command) => {
    const view = viewRef.current
    if (!view) return
    command(view.state, view.dispatch, view)
    view.focus()
  }
  const requestCitation = () => {
    const view = viewRef.current
    if (!view) return
    const bookmark = view.state.selection.getBookmark()
    props.onRequestCitation?.((keys, style, details, bibliography, syntax) => {
      const current = viewRef.current
      if (!current) return
      const transaction = current.state.tr
      try { transaction.setSelection(bookmark.resolve(current.state.doc)) } catch {
        transaction.setSelection(current.state.selection)
      }
      transaction.replaceSelectionWith(visualDocumentSchema.nodes.citation.create({
        keys, style, prefix: details?.prefix ?? '', suffix: details?.suffix ?? '',
        syntax: syntax ?? propsRef.current.citationSyntax ?? 'role',
        label: visualCitationLabel(keys, style, bibliography ?? propsRef.current.bibliography ?? '', details),
      }))
      current.dispatch(transaction.scrollIntoView())
      current.focus()
    })
  }

  const toolbar = <div className="visual-inline-toolbar continuous-visual-toolbar" onMouseDown={(event) => event.preventDefault()}>
        <button type="button" title="Link" disabled={!props.editable} onClick={() => setLinkUrl((current) => current === null ? 'https://' : null)}><Link2 size={15} /></button>
        <button type="button" title="Cite a paper" disabled={!props.editable} onClick={requestCitation}><AtSign size={15} /></button>
      </div>
  const finishObject = (commit: boolean, focus = true) => {
    const edit = objectEditRef.current
    if (!edit) return true
    const pane = edit.host?.closest<HTMLElement>('.preview-pane')
    const scrollTop = pane?.scrollTop
    const scrollLeft = pane?.scrollLeft
    const source = `${edit.prefix}${edit.value}${edit.suffix}`
    if (commit && source !== edit.base) {
      const result = edit.apply(source)
      if (result !== 'applied') {
        const retained = { ...edit, error: result === 'conflict'
          ? 'This object changed elsewhere. Your draft is retained; review the shared version before applying.'
          : 'This object can no longer be edited. Your draft is retained.' }
        persistObjectRef.current(retained)
        setObjectEdit(retained)
        return false
      }
    }
    const restoreFigure = commit && source !== edit.base && /^(?::::|```|~~~)\{figure\}/.test(edit.base)
    edit.close()
    writeVisualRecoveryDraft(edit.recoveryKey, null)
    persistObjectRef.current(null)
    setObjectEdit(null)
    if (restoreFigure) refreshRef.current(sourceRef.current, true)
    if (focus) viewRef.current?.focus()
    if (pane && scrollTop !== undefined && scrollLeft !== undefined) {
      pane.scrollTop = scrollTop
      pane.scrollLeft = scrollLeft
    }
    return true
  }
  useLayoutEffect(() => { finishObjectRef.current = finishObject })
  const objectEditing = objectEdit !== null
  const objectHost = objectEdit?.host
  useLayoutEffect(() => {
    if (objectEditing) objectSourceRef.current?.focus({ preventScroll: true })
  }, [objectEditing, objectHost])
  const closeObject = () => { finishObjectRef.current(false) }
  const applyObject = () => { finishObjectRef.current(true) }
  const objectEditor = objectEdit && <section ref={objectPanelRef} className="visual-object-editor"
    aria-label={`Edit ${objectEdit.kind}`}>
    <header><strong>{objectEdit.kind === 'equation' ? 'Equation' : 'MyST object'}</strong>
      <div className="visual-object-actions">
        <button type="button" title={`Apply ${objectEdit.kind}`} disabled={!props.editable || !objectEdit.host || objectEdit.suggestionMode !== props.suggestionMode} onClick={applyObject}><Check size={16} /></button>
        <button type="button" title="Cancel object edit" onClick={closeObject}><X size={16} /></button>
      </div>
    </header>
    <textarea ref={objectSourceRef} spellCheck={false} aria-label={objectEdit.kind === 'equation' ? 'LaTeX equation' : 'MyST object source'}
      readOnly={!props.editable || objectEdit.suggestionMode !== props.suggestionMode}
      value={objectEdit.value} onChange={(event) => {
        const next = { ...objectEdit, value: event.target.value }
        persistObjectRef.current(next)
        setObjectEdit(next)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeObject() }
        else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault(); event.stopPropagation(); applyObject()
        }
      }} />
    {objectEdit.error && <p className="visual-block-error" role="alert">{objectEdit.error}</p>}
  </section>
  return (
    <article className="continuous-visual-editor" aria-label="Visual MyST editor"
      onMouseDownCapture={() => { focusedReviewRef.current = null }}
      onFocusCapture={(event) => {
        const target = event.target
        if (!(target instanceof HTMLElement) || target.getAttribute('role') !== 'button') return
        if (target.dataset.mystCommentId || target.dataset.mystSuggestionId) {
          focusedReviewRef.current = { commentId: target.dataset.mystCommentId,
            suggestionId: target.dataset.mystSuggestionId }
        }
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) focusedReviewRef.current = null
      }}
      onKeyDownCapture={(event) => {
        const review = focusedReviewRef.current
        if (!review || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        event.stopPropagation()
        focusedReviewRef.current = null
        if (review.commentId) props.onCommentClick?.(review.commentId)
        else if (review.suggestionId) props.onSuggestionClick?.(review.suggestionId)
      }}>
      {props.toolbarHost ? createPortal(toolbar, props.toolbarHost) : toolbar}
      {linkUrl !== null && <form className="visual-link-editor" onSubmit={(event) => {
        event.preventDefault()
        const href = safeVisualLinkTarget(linkUrl.trim())
        if (!href) { setError('This link destination is not allowed.'); return }
        run(toggleMark(visualDocumentSchema.marks.link, { href, title: null }))
        setError(null)
        setLinkUrl(null)
      }}><input autoFocus aria-label="Link URL" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
        <button type="submit">Apply</button></form>}
      <div ref={containerRef} />
      {objectEdit?.host ? createPortal(objectEditor, objectEdit.host) : objectEditor}
      {(pending || error || backupUnavailable) && <div className="visual-draft-status" role={error || backupUnavailable ? 'alert' : 'status'}>
        <span>{error ?? (backupUnavailable ? 'Browser draft backup unavailable. Keep this tab open or download recovery.' : 'Saving suggestion...')}</span>
        {error && <button type="button" onClick={() => flushRef.current()}>Retry</button>}
      </div>}
      {selectionComment && props.onCommentSelection && createPortal(
        <button type="button" className="myst-selection-comment" title="Comment on selection"
          style={{ left: selectionComment.left, top: selectionComment.top }}
          onMouseDown={(event) => event.preventDefault()} onClick={() => {
            props.onCommentSelection?.(selectionComment.range)
            setSelectionComment(null)
          }}><MessageSquarePlus size={16} aria-hidden="true" /><span>Comment</span></button>, document.body,
      )}
    </article>
  )
}