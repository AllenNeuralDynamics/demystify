import {
  AtSign,
  Bold,
  Check,
  Code2,
  Italic,
  Link2,
  X,
} from 'lucide-react'
import { baseKeymap, toggleMark } from 'prosemirror-commands'
import { history, redo, undo } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { EditorState, type Command } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { useEffect, useRef, useState } from 'react'
import type { MystEditableBlock } from '../lib/myst'
import type { CitationStyle } from '../lib/references'
import {
  createVisualInlineDocument,
  serializeVisualInlineDocument,
  visualCitationLabel,
  visualInlineSchema,
} from '../lib/visualInline'

export type VisualCitationInserter = (
  keys: string[],
  style: CitationStyle,
  bibliography?: string,
) => void

interface VisualInlineEditorProps {
  bibliography: string
  block: MystEditableBlock
  error?: string | null
  onCancel: () => void
  onRequestCitation: (insert: VisualCitationInserter) => void
  onSave: (source: string) => void
}

const insertHardBreak: Command = (state, dispatch) => {
  dispatch?.(
    state.tr
      .replaceSelectionWith(visualInlineSchema.nodes.hard_break.create())
      .scrollIntoView(),
  )
  return true
}

type VisualMarkName = 'strong' | 'emphasis' | 'code' | 'link'

const activeMarksForState = (state: EditorState) => {
  const result: Record<VisualMarkName, boolean> = {
    strong: false,
    emphasis: false,
    code: false,
    link: false,
  }
  for (const name of Object.keys(result) as VisualMarkName[]) {
  const mark = visualInlineSchema.marks[name]
    const { from, to, empty, $from } = state.selection
    result[name] = empty
      ? Boolean(mark.isInSet(state.storedMarks ?? $from.marks()))
      : state.doc.rangeHasMark(from, to, mark)
  }
  return result
}

export const VisualInlineEditor = ({
  bibliography,
  block,
  error,
  onCancel,
  onRequestCitation,
  onSave,
}: VisualInlineEditorProps) => {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const bibliographyRef = useRef(bibliography)
  const onCancelRef = useRef(onCancel)
  const onSaveRef = useRef(onSave)
  const [activeMarks, setActiveMarks] = useState<Record<VisualMarkName, boolean>>({
    strong: false,
    emphasis: false,
    code: false,
    link: false,
  })
  const [linkEditorOpen, setLinkEditorOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('https://')

  useEffect(() => {
    bibliographyRef.current = bibliography
  }, [bibliography])

  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return
    const save: Command = (state) => {
      onSaveRef.current(serializeVisualInlineDocument(state.doc))
      return true
    }
    const cancel: Command = () => {
      onCancelRef.current()
      return true
    }
    const state = EditorState.create({
      doc: createVisualInlineDocument(block.inline, bibliographyRef.current),
      plugins: [
        history(),
        keymap({
          'Mod-b': toggleMark(visualInlineSchema.marks.strong),
          'Mod-i': toggleMark(visualInlineSchema.marks.emphasis),
          'Mod-`': toggleMark(visualInlineSchema.marks.code),
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
          'Mod-Enter': save,
          Escape: cancel,
          Enter: block.kind === 'heading' ? save : insertHardBreak,
        }),
        keymap(baseKeymap),
      ],
    })
    const view = new EditorView(container, {
      state,
      attributes: {
        class: 'visual-prosemirror',
        role: 'textbox',
        'aria-label': block.kind === 'heading' ? 'Edit heading' : 'Edit paragraph',
        'aria-multiline': block.kind === 'paragraph' ? 'true' : 'false',
      },
      dispatchTransaction: (transaction) => {
        const nextState = view.state.apply(transaction)
        view.updateState(nextState)
        setActiveMarks(activeMarksForState(nextState))
      },
    })
    viewRef.current = view
    view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [block.id, block.inline, block.kind])

  const runCommand = (command: Command) => {
    const view = viewRef.current
    if (!view) return
    command(view.state, view.dispatch, view)
    view.focus()
  }

  const save = () => {
    const view = viewRef.current
    if (view) onSave(serializeVisualInlineDocument(view.state.doc))
  }

  const applyLink = () => {
    const href = linkUrl.trim()
    if (!href) return
    runCommand(toggleMark(visualInlineSchema.marks.link, { href, title: null }))
    setLinkEditorOpen(false)
  }

  const requestCitation = () => {
    const view = viewRef.current
    if (!view) return
    const bookmark = view.state.selection.getBookmark()
    onRequestCitation((keys, style, updatedBibliography) => {
      const currentView = viewRef.current
      if (!currentView) return
      let transaction = currentView.state.tr
      try {
        transaction = transaction.setSelection(bookmark.resolve(currentView.state.doc))
      } catch {
        // If local typing changed the bookmark, insert at the current selection.
      }
      const citation = visualInlineSchema.nodes.citation.create({
        keys,
        style,
        label: visualCitationLabel(
          keys,
          style,
          updatedBibliography ?? bibliographyRef.current,
        ),
      })
      currentView.dispatch(transaction.replaceSelectionWith(citation).scrollIntoView())
      currentView.focus()
    })
  }

  const preventToolbarBlur = (event: React.MouseEvent) => event.preventDefault()

  return (
    <span className="visual-inline-editor">
      <span className="visual-inline-toolbar" onMouseDown={preventToolbarBlur}>
        <button
          className={activeMarks.strong ? 'active' : ''}
          type="button"
          title="Bold"
          onClick={() => runCommand(toggleMark(visualInlineSchema.marks.strong))}
        >
          <Bold size={15} />
        </button>
        <button
          className={activeMarks.emphasis ? 'active' : ''}
          type="button"
          title="Italic"
          onClick={() => runCommand(toggleMark(visualInlineSchema.marks.emphasis))}
        >
          <Italic size={15} />
        </button>
        <button
          className={activeMarks.code ? 'active' : ''}
          type="button"
          title="Inline code"
          onClick={() => runCommand(toggleMark(visualInlineSchema.marks.code))}
        >
          <Code2 size={15} />
        </button>
        <button
          className={activeMarks.link || linkEditorOpen ? 'active' : ''}
          type="button"
          title="Link"
          onClick={() => setLinkEditorOpen((open) => !open)}
        >
          <Link2 size={15} />
        </button>
        <button type="button" title="Cite a paper" onClick={requestCitation}>
          <AtSign size={15} />
        </button>
        <span className="visual-inline-toolbar-spacer" />
        <button type="button" title="Save visual edit" onClick={save}>
          <Check size={15} />
        </button>
        <button type="button" title="Cancel visual edit" onClick={onCancel}>
          <X size={15} />
        </button>
      </span>
      {linkEditorOpen && (
        <span className="visual-link-editor">
          <input
            autoFocus
            aria-label="Link URL"
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                applyLink()
              }
              if (event.key === 'Escape') setLinkEditorOpen(false)
            }}
          />
          <button type="button" onMouseDown={preventToolbarBlur} onClick={applyLink}>Apply</button>
        </span>
      )}
      <span className="visual-inline-surface" ref={editorContainerRef} />
      {error && <span className="visual-block-error" role="alert">{error}</span>}
    </span>
  )
}