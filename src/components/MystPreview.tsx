import katex from 'katex'
import 'katex/dist/katex.min.css'
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
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  CollaborativeTextEditAnchor,
  CollaborativeTextEditResult,
} from '../lib/collaborativeTextEdit'
import { renderMyst, type MystEditableBlock } from '../lib/myst'
import {
  VisualInlineEditor,
  type VisualCitationInserter,
} from './VisualInlineEditor'

interface MystPreviewProps {
  assetBaseUrl?: string
  bibliography?: string
  content: string
  editable?: boolean
  onBeginEdit?: (block: MystEditableBlock) => CollaborativeTextEditAnchor | null
  onCommitEdit?: (
    anchor: CollaborativeTextEditAnchor,
    replacement: string,
  ) => CollaborativeTextEditResult
  onEditError?: (message: string) => void
  onRequestCitation?: (insert: VisualCitationInserter) => void
}

interface ActiveVisualEdit {
  anchor: CollaborativeTextEditAnchor
  block: MystEditableBlock
  error: string | null
  target: HTMLElement
}

const previewDelayMs = 400

export const MystPreview = memo(({
  assetBaseUrl,
  bibliography = '',
  content,
  editable = false,
  onBeginEdit,
  onCommitEdit,
  onEditError,
  onRequestCitation,
}: MystPreviewProps) => {
  const previewRef = useRef<HTMLElement>(null)
  const deferredContent = useDeferredValue(content)
  const [previewContent, setPreviewContent] = useState(deferredContent)
  const [activeEdit, setActiveEdit] = useState<ActiveVisualEdit | null>(null)
  const preview = useMemo(
    () => renderMyst(previewContent, { assetBaseUrl, bibliography }),
    [assetBaseUrl, bibliography, previewContent],
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
    setActiveEdit({ anchor, block, error: null, target })
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

  const commitEditing = (draft: string) => {
    if (!activeEdit || !onCommitEdit) return
    const replacement = activeEdit.block.kind === 'heading'
      ? draft.trim()
      : draft
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
        <VisualInlineEditor
          bibliography={bibliography}
          block={activeEdit.block}
          error={activeEdit.error}
          onCancel={cancelEditing}
          onRequestCitation={(insert) => onRequestCitation?.(insert)}
          onSave={commitEditing}
        />,
        activeEdit.target,
      )}
    </>
  )
})
