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
import { detectCitationSyntax } from '../lib/references'
import {
  VisualInlineEditor,
  type VisualCitationInserter,
} from './VisualInlineEditor'

interface MystPreviewProps {
  assetBaseUrl?: string
  bibliography?: string
  content: string
  editable?: boolean
  projectFiles?: Record<string, string>
  sourcePath?: string
  onBeginEdit?: (block: MystEditableBlock) => CollaborativeTextEditAnchor | null
  onCommitEdit?: (
    anchor: CollaborativeTextEditAnchor,
    replacement: string,
  ) => CollaborativeTextEditResult
  onEditError?: (message: string) => void
  onRequestCitation?: (insert: VisualCitationInserter) => void
  onSuggestionClick?: (suggestionId: string) => void
  suggestions?: MystPreviewSuggestion[]
}

export interface MystPreviewSuggestion {
  id: string
  from: number
  to: number
  before: string
  after: string
  authorName: string
  authorColor: string
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
  projectFiles,
  sourcePath,
  onBeginEdit,
  onCommitEdit,
  onEditError,
  onRequestCitation,
  onSuggestionClick,
  suggestions = [],
}: MystPreviewProps) => {
  const previewRef = useRef<HTMLElement>(null)
  const deferredContent = useDeferredValue(content)
  const [previewContent, setPreviewContent] = useState(deferredContent)
  const [activeEdit, setActiveEdit] = useState<ActiveVisualEdit | null>(null)
  const preview = useMemo(
    () => renderMyst(previewContent, {
      assetBaseUrl,
      bibliography,
      projectFiles,
      sourcePath,
    }),
    [assetBaseUrl, bibliography, previewContent, projectFiles, sourcePath],
  )
  const editableBlocks = useMemo(
    () => new Map(preview.editableBlocks.map((block) => [block.id, block])),
    [preview.editableBlocks],
  )
  const citationSyntax = useMemo(() => detectCitationSyntax(content), [content])
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

    for (const suggestion of suggestions) {
      const block = preview.editableBlocks.find((candidate) =>
        candidate.from === suggestion.from &&
        candidate.to === suggestion.to &&
        candidate.value === suggestion.before)
      if (!block) continue
      const target = Array.from(
        previewElement.querySelectorAll<HTMLElement>('[data-myst-edit-id]'),
      ).find((element) => element.dataset.mystEditId === block.id)
      if (!target) continue

      const originalNodes = Array.from(target.childNodes)
      const captionNumber = originalNodes[0] instanceof HTMLElement &&
        originalNodes[0].classList.contains('caption-number')
        ? originalNodes.shift()
        : null
      const captionGap = captionNumber && originalNodes[0]?.nodeType === Node.TEXT_NODE &&
        /^\s*$/.test(originalNodes[0].textContent ?? '')
        ? originalNodes.shift()
        : null
      const deletion = document.createElement('del')
      deletion.className = 'myst-suggestion-deletion'
      originalNodes.forEach((node) => deletion.append(node))

      const insertion = document.createElement('ins')
      insertion.className = 'myst-suggestion-insertion'
      const renderedReplacement = renderMyst(suggestion.after, {
        assetBaseUrl,
        bibliography,
        projectFiles,
        sourcePath,
      })
      const replacementTemplate = document.createElement('template')
      replacementTemplate.innerHTML = renderedReplacement.html
      const replacementBlock = replacementTemplate.content.querySelector<HTMLElement>(
        '[data-myst-edit-id]',
      )
      if (replacementBlock) insertion.append(...Array.from(replacementBlock.childNodes))
      else insertion.textContent = suggestion.after

      const author = document.createElement('span')
      author.className = 'myst-suggestion-author'
      author.textContent = suggestion.authorName
      target.replaceChildren(
        ...(captionNumber ? [captionNumber, captionGap ?? document.createTextNode(' ')] : []),
        deletion,
        ...(suggestion.after ? [document.createTextNode(' '), insertion] : []),
        author,
      )
      target.classList.add('myst-inline-suggestion')
      target.dataset.mystSuggestionId = suggestion.id
      target.style.setProperty('--myst-suggestion-color', suggestion.authorColor)
      target.tabIndex = 0
      target.title = `Suggested by ${suggestion.authorName}; open review discussion`
      target.setAttribute(
        'aria-label',
        `Suggested edit by ${suggestion.authorName}. Press Enter to open the review discussion.`,
      )
    }

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
          if (element.dataset.mystSuggestionId) return
          element.classList.add('myst-editable-block')
          element.tabIndex = 0
          element.title = 'Drag to select; click to edit'
        })
    }
  }, [
    activeEdit,
    assetBaseUrl,
    bibliography,
    canEdit,
    preview.editableBlocks,
    preview.html,
    projectFiles,
    sourcePath,
    suggestions,
  ])

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
    const suggestion = target.closest<HTMLElement>('[data-myst-suggestion-id]')
    if (suggestion?.dataset.mystSuggestionId) {
      onSuggestionClick?.(suggestion.dataset.mystSuggestionId)
      return
    }
    const block = target.closest<HTMLElement>('[data-myst-edit-id]')
    const selection = window.getSelection()
    if (
      selection &&
      !selection.isCollapsed &&
      previewRef.current?.contains(selection.anchorNode) &&
      previewRef.current.contains(selection.focusNode)
    ) return
    if (block && previewRef.current?.contains(block)) beginEditing(block)
  }

  const handlePreviewKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== 'F2') return
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.dataset.mystSuggestionId &&
      event.key === 'Enter'
    ) {
      event.preventDefault()
      onSuggestionClick?.(target.dataset.mystSuggestionId)
      return
    }
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
          citationSyntax={detectCitationSyntax(activeEdit.block.value, citationSyntax)}
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
