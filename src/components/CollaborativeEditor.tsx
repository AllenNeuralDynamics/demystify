import { redo, undo } from '@codemirror/commands'
import { snippet } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import { getCommentRange } from '../lib/commentAnchors'
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

interface CollaborativeEditorProps {
  sharedText: Y.Text
  provider: WebsocketProvider
  commentHighlights?: CommentHighlight[]
  onCommentClick?: (commentId: string) => void
  readOnly?: boolean
}

export interface CollaborativeEditorHandle {
  undo: () => void
  redo: () => void
  wrapSelection: (before: string, after?: string) => void
  insertSnippet: (template: string, selectedTextPlaceholder?: string) => void
  getCommentSelection: () => { from: number; to: number } | null
  revealRange: (from: number, to: number) => void
  focus: () => void
}

const setCommentHighlights = StateEffect.define<CommentHighlight[]>()

const commentHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    for (const effect of transaction.effects) {
      if (!effect.is(setCommentHighlights)) continue
      return Decoration.set(
        effect.value
          .filter((highlight) => highlight.to > highlight.from)
          .sort((first, second) => first.from - second.from)
          .map((highlight) => Decoration.mark({
            class: [
              'cm-comment-anchor',
              highlight.resolved ? 'is-resolved' : '',
              highlight.active ? 'is-active' : '',
            ].filter(Boolean).join(' '),
            attributes: { 'data-comment-id': highlight.id },
          }).range(highlight.from, highlight.to)),
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
    color: '#b3b8b5',
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
})

export const CollaborativeEditor = forwardRef<
  CollaborativeEditorHandle,
  CollaborativeEditorProps
>(({ sharedText, provider, commentHighlights = [], onCommentClick, readOnly = false }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onCommentClickRef = useRef(onCommentClick)
  const readOnlyRef = useRef(readOnly)
  const readOnlyCompartmentRef = useRef(new Compartment())

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
    viewRef.current = view

    return () => {
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
      effects: setCommentHighlights.of(commentHighlights),
    })
  }, [commentHighlights])

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
      const { from, to } = view.state.selection.main
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
      const { from, to } = view.state.selection.main
      const selectedText = view.state.sliceDoc(from, to)
      const resolvedTemplate = fillSnippetSelection(
        template,
        selectedTextPlaceholder,
        selectedText,
      )
      snippet(resolvedTemplate)(view, null, from, to)
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

  return <div className="collaborative-editor" ref={containerRef} />
})

CollaborativeEditor.displayName = 'CollaborativeEditor'