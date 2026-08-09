import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Check, X } from 'lucide-react'
import morphdom from 'morphdom'
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  CollaborativeTextEditAnchor,
  CollaborativeTextEditResult,
} from '../lib/collaborativeTextEdit'
import { renderMyst, type MystEditableBlock } from '../lib/myst'

interface MystPreviewProps {
  assetBaseUrl?: string
  content: string
  editable?: boolean
  onBeginEdit?: (block: MystEditableBlock) => CollaborativeTextEditAnchor | null
  onCommitEdit?: (
    anchor: CollaborativeTextEditAnchor,
    replacement: string,
  ) => CollaborativeTextEditResult
  onEditError?: (message: string) => void
}

interface ActiveVisualEdit {
  anchor: CollaborativeTextEditAnchor
  block: MystEditableBlock
  draft: string
  error: string | null
  target: HTMLElement
}

const previewDelayMs = 400

export const MystPreview = memo(({
  assetBaseUrl,
  content,
  editable = false,
  onBeginEdit,
  onCommitEdit,
  onEditError,
}: MystPreviewProps) => {
  const previewRef = useRef<HTMLElement>(null)
  const deferredContent = useDeferredValue(content)
  const [previewContent, setPreviewContent] = useState(deferredContent)
  const [activeEdit, setActiveEdit] = useState<ActiveVisualEdit | null>(null)
  const preview = useMemo(
    () => renderMyst(previewContent, { assetBaseUrl }),
    [assetBaseUrl, previewContent],
  )
  const editableBlocks = useMemo(
    () => new Map(preview.editableBlocks.map((block) => [block.id, block])),
    [preview.editableBlocks],
  )
  const canEdit = editable && Boolean(onBeginEdit && onCommitEdit)

  useEffect(() => {
    if (deferredContent === previewContent) return
    const timeout = window.setTimeout(() => {
      startTransition(() => setPreviewContent(deferredContent))
    }, previewDelayMs)
    return () => window.clearTimeout(timeout)
  }, [deferredContent, previewContent])

  useLayoutEffect(() => {
    const previewElement = previewRef.current
    if (!previewElement || activeEdit) return

    const nextPreview = previewElement.cloneNode(false) as HTMLElement
    nextPreview.innerHTML = preview.html
    morphdom(previewElement, nextPreview, { childrenOnly: true })

    previewElement
      .querySelectorAll<HTMLElement>('.math-display, .math-inline')
      .forEach((element) => {
        katex.render(element.textContent ?? '', element, {
          displayMode: element.classList.contains('math-display'),
          throwOnError: false,
          strict: 'ignore',
        })
      })

    if (canEdit) {
      previewElement
        .querySelectorAll<HTMLElement>('[data-myst-edit-id]')
        .forEach((element) => {
          element.classList.add('myst-editable-block')
          element.tabIndex = 0
          element.title = 'Edit in visual view'
        })
    }
  }, [activeEdit, canEdit, preview.html])

  useEffect(() => {
    if (!canEdit && activeEdit) setActiveEdit(null)
  }, [activeEdit, canEdit])

  const beginEditing = (target: HTMLElement) => {
    if (activeEdit || !canEdit || !onBeginEdit) return
    const blockId = target.dataset.mystEditId
    const block = blockId ? editableBlocks.get(blockId) : undefined
    if (!block) return

    const anchor = onBeginEdit(block)
    if (!anchor) {
      onEditError?.('The preview changed before editing began. Try the block again.')
      return
    }

    target.replaceChildren()
    target.classList.add('is-visual-editing')
    setActiveEdit({ anchor, block, draft: block.value, error: null, target })
  }

  const handlePreviewClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const block = target.closest<HTMLElement>('[data-myst-edit-id]')
    if (block && previewRef.current?.contains(block)) beginEditing(block)
  }

  const handlePreviewKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== 'F2') return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.matches('[data-myst-edit-id]')) return
    event.preventDefault()
    beginEditing(target)
  }

  const cancelEditing = () => setActiveEdit(null)

  const commitEditing = () => {
    if (!activeEdit || !onCommitEdit) return
    const replacement = activeEdit.block.kind === 'heading'
      ? activeEdit.draft.trim()
      : activeEdit.draft
    if (activeEdit.block.kind === 'heading' && !replacement) {
      setActiveEdit((current) => current
        ? { ...current, error: 'A heading cannot be empty.' }
        : current)
      return
    }

    const result = onCommitEdit(activeEdit.anchor, replacement)
    if (result === 'applied') {
      setActiveEdit(null)
      return
    }
    setActiveEdit((current) => current
      ? {
          ...current,
          error: result === 'conflict'
            ? 'This block changed elsewhere. Cancel and reopen it before editing.'
            : 'Visual editing is no longer available for this document.',
        }
      : current)
  }

  const handleEditorKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditing()
    } else if (
      (activeEdit?.block.kind === 'heading' && event.key === 'Enter') ||
      (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
    ) {
      event.preventDefault()
      commitEditing()
    }
  }

  const handleEditorBlur = (event: ReactFocusEvent<HTMLSpanElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      commitEditing()
    }
  }

  if (preview.error && !activeEdit) {
    return (
      <div className="preview-error" role="status">
        <strong>Preview paused</strong>
        <span>{preview.error}</span>
      </div>
    )
  }

  return (
    <>
      <article
        ref={previewRef}
        className="myst-preview"
        aria-label={canEdit ? 'Visual MyST editor' : 'Rendered MyST preview'}
        onClick={handlePreviewClick}
        onKeyDown={handlePreviewKeyDown}
      />
      {activeEdit && createPortal(
        <span className="visual-block-editor" onBlur={handleEditorBlur}>
          {activeEdit.block.kind === 'heading' ? (
            <input
              autoFocus
              aria-label="Edit heading"
              className="visual-block-field"
              value={activeEdit.draft}
              onChange={(event) => setActiveEdit((current) => current
                ? { ...current, draft: event.target.value, error: null }
                : current)}
              onKeyDown={handleEditorKeyDown}
            />
          ) : (
            <textarea
              autoFocus
              aria-label="Edit paragraph"
              className="visual-block-field"
              rows={Math.max(2, Math.min(10, activeEdit.draft.split('\n').length + 1))}
              value={activeEdit.draft}
              onChange={(event) => setActiveEdit((current) => current
                ? { ...current, draft: event.target.value, error: null }
                : current)}
              onKeyDown={handleEditorKeyDown}
            />
          )}
          <span className="visual-block-actions">
            <button type="button" title="Save visual edit" onClick={commitEditing}>
              <Check size={15} />
            </button>
            <button type="button" title="Cancel visual edit" onClick={cancelEditing}>
              <X size={15} />
            </button>
          </span>
          {activeEdit.error && (
            <span className="visual-block-error" role="alert">
              {activeEdit.error}
            </span>
          )}
        </span>,
        activeEdit.target,
      )}
    </>
  )
})
