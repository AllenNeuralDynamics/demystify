import { redo, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { yCollab } from 'y-codemirror.next'
import type { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'

interface CollaborativeEditorProps {
  sharedText: Y.Text
  provider: WebsocketProvider
}

export interface CollaborativeEditorHandle {
  undo: () => void
  redo: () => void
  wrapSelection: (before: string, after?: string) => void
  prefixLine: (prefix: string) => void
  focus: () => void
}

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
})

export const CollaborativeEditor = forwardRef<
  CollaborativeEditorHandle,
  CollaborativeEditorProps
>(({ sharedText, provider }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const undoManager = new Y.UndoManager(sharedText)
    const state = EditorState.create({
      doc: sharedText.toString(),
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        editorTheme,
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

  useImperativeHandle(ref, () => ({
    undo: () => {
      if (viewRef.current) undo(viewRef.current)
    },
    redo: () => {
      if (viewRef.current) redo(viewRef.current)
    },
    wrapSelection: (before, after = before) => {
      const view = viewRef.current
      if (!view) return
      const { from, to } = view.state.selection.main
      const selectedText = view.state.sliceDoc(from, to)
      view.dispatch({
        changes: { from, to, insert: `${before}${selectedText}${after}` },
        selection: { anchor: from + before.length, head: to + before.length },
      })
      view.focus()
    },
    prefixLine: (prefix) => {
      const view = viewRef.current
      if (!view) return
      const line = view.state.doc.lineAt(view.state.selection.main.head)
      view.dispatch({
        changes: { from: line.from, insert: prefix },
        selection: { anchor: view.state.selection.main.head + prefix.length },
      })
      view.focus()
    },
    focus: () => viewRef.current?.focus(),
  }))

  return <div className="collaborative-editor" ref={containerRef} />
})

CollaborativeEditor.displayName = 'CollaborativeEditor'