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
  liveEditing?: boolean
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
  active?: boolean
  projection?: 'accepted' | 'working'
}

interface ActiveVisualEdit {
  anchor: CollaborativeTextEditAnchor
  block: MystEditableBlock
  error: string | null
  target: HTMLElement
}

const previewDelayMs = 400

const enableSuggestionKeyboardActivation = (element: HTMLElement) => {
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    element.click()
  })
}

export const MystPreview = memo(({
  assetBaseUrl,
  bibliography = '',
  content,
  editable = false,
  liveEditing = false,
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

    const suggestionsByBlock = new Map<string, {
      block: MystEditableBlock
      suggestions: Array<MystPreviewSuggestion & {
        renderedAfter: string
        renderBeforeBlock: boolean
      }>
    }>()
    for (const suggestion of suggestions) {
      if (suggestion.projection === 'working') {
        const block = preview.editableBlocks.find((candidate) =>
          candidate.from <= suggestion.from &&
          candidate.to >= suggestion.to &&
          candidate.value.slice(
            suggestion.from - candidate.from,
            suggestion.to - candidate.from,
          ) === suggestion.after)
        if (!block) continue
        const group = suggestionsByBlock.get(block.id) ?? { block, suggestions: [] }
        group.suggestions.push({
          ...suggestion,
          renderedAfter: block.value,
          renderBeforeBlock: false,
        })
        suggestionsByBlock.set(block.id, group)
        continue
      }
      const matchingBlock = preview.editableBlocks.find((candidate) =>
        candidate.from <= suggestion.from &&
        candidate.to >= suggestion.to &&
        candidate.value.slice(
          suggestion.from - candidate.from,
          suggestion.to - candidate.from,
        ) === suggestion.before)
      const block = matchingBlock ?? (
        suggestion.from === suggestion.to && !suggestion.before
          ? ([...preview.editableBlocks]
              .reverse()
              .find((candidate) => candidate.to <= suggestion.from) ??
            preview.editableBlocks.find((candidate) => candidate.from >= suggestion.from))
          : undefined
      )
      if (!block) continue
      const renderBeforeBlock = suggestion.from === suggestion.to &&
        !suggestion.before &&
        suggestion.from <= block.from
      const relativeFrom = Math.max(0, Math.min(block.value.length, suggestion.from - block.from))
      const relativeTo = Math.max(relativeFrom, Math.min(
        block.value.length,
        suggestion.to - block.from,
      ))
      const renderedAfter = suggestion.from === suggestion.to &&
        (renderBeforeBlock || suggestion.from >= block.to)
        ? suggestion.after
        : `${block.value.slice(0, relativeFrom)}${suggestion.after}${block.value.slice(relativeTo)}`
      const group = suggestionsByBlock.get(block.id) ?? { block, suggestions: [] }
      group.suggestions.push({ ...suggestion, renderedAfter, renderBeforeBlock })
      suggestionsByBlock.set(block.id, group)
    }

    for (const { block, suggestions: blockSuggestions } of suggestionsByBlock.values()) {
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
      deletion.dataset.mystSuggestionId = blockSuggestions[0].id
      deletion.tabIndex = 0
      deletion.setAttribute('role', 'button')
      const workingProjection = blockSuggestions.every(
        (suggestion) => suggestion.projection === 'working',
      )
      if (workingProjection) {
        const active = blockSuggestions.some((suggestion) => suggestion.active)
        if (active) deletion.classList.add('is-active')
        const acceptedBlock = [...blockSuggestions]
          .sort((first, second) => second.from - first.from)
          .reduce((value, suggestion) => {
            const relativeFrom = suggestion.from - block.from
            const relativeTo = suggestion.to - block.from
            return `${value.slice(0, relativeFrom)}${suggestion.before}${value.slice(relativeTo)}`
          }, block.value)
        const acceptedPreview = renderMyst(acceptedBlock, {
          assetBaseUrl,
          bibliography,
          projectFiles,
          sourcePath,
        })
        const acceptedTemplate = document.createElement('template')
        acceptedTemplate.innerHTML = acceptedPreview.html
        const acceptedElement = acceptedTemplate.content.querySelector<HTMLElement>(
          '[data-myst-edit-id]',
        )
        if (acceptedElement) deletion.append(...Array.from(acceptedElement.childNodes))
        else deletion.textContent = acceptedBlock

        const primarySuggestion = blockSuggestions[0]
        const option = document.createElement('span')
        option.className = [
          'myst-suggestion-option',
          active ? 'is-active' : '',
        ].filter(Boolean).join(' ')
        option.dataset.mystSuggestionId = primarySuggestion.id
        option.style.setProperty('--myst-suggestion-color', primarySuggestion.authorColor)
        option.tabIndex = 0
        option.setAttribute('role', 'button')
        option.title = 'Open this suggestion in Review'
        option.setAttribute(
          'aria-label',
          'Current proposed block. Press Enter to open this change in Review.',
        )
        enableSuggestionKeyboardActivation(option)

        const insertion = document.createElement('ins')
        insertion.className = 'myst-suggestion-insertion'
        insertion.append(...originalNodes)
        const author = document.createElement('span')
        author.className = 'myst-suggestion-author'
        author.textContent = Array.from(new Set(
          blockSuggestions.map((suggestion) => suggestion.authorName),
        )).join(', ')
        option.append(insertion, author)

        target.replaceChildren(
          ...(captionNumber ? [captionNumber, captionGap ?? document.createTextNode(' ')] : []),
          deletion,
          document.createTextNode(' '),
          option,
        )
        target.classList.add('myst-inline-suggestion')
        if (active) target.classList.add('is-active')
        target.style.setProperty('--myst-suggestion-color', primarySuggestion.authorColor)
        target.title = 'Select this proposed block to review its changes; press F2 to edit it.'
        continue
      }
      originalNodes.forEach((node) => deletion.append(node))
      const insertionGroup = blockSuggestions.every((suggestion) => !suggestion.before)

      const alternatives = blockSuggestions.map((suggestion) => {
        const option = document.createElement('span')
        option.className = 'myst-suggestion-option'
        option.dataset.mystSuggestionId = suggestion.id
        option.style.setProperty('--myst-suggestion-color', suggestion.authorColor)
        option.tabIndex = 0
        option.setAttribute('role', 'button')
        option.title = `Suggested by ${suggestion.authorName}; open review discussion`
        option.setAttribute(
          'aria-label',
          `Suggested edit by ${suggestion.authorName}. Press Enter to open the review discussion.`,
        )
        enableSuggestionKeyboardActivation(option)

        const insertion = document.createElement('ins')
        insertion.className = 'myst-suggestion-insertion'
        const renderedReplacement = renderMyst(suggestion.renderedAfter, {
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
        else insertion.textContent = suggestion.renderedAfter

        const author = document.createElement('span')
        author.className = 'myst-suggestion-author'
        author.textContent = suggestion.authorName
        option.append(insertion, author)
        return option
      })
      const beforeAlternatives = alternatives.filter(
        (_, index) => blockSuggestions[index].renderBeforeBlock,
      )
      const afterAlternatives = alternatives.filter(
        (_, index) => !blockSuggestions[index].renderBeforeBlock,
      )
      target.replaceChildren(
        ...(captionNumber ? [captionNumber, captionGap ?? document.createTextNode(' ')] : []),
        ...beforeAlternatives.flatMap((alternative) => [alternative, document.createTextNode(' ')]),
        ...(insertionGroup ? originalNodes : [deletion]),
        ...afterAlternatives.flatMap((alternative) => [document.createTextNode(' '), alternative]),
      )
      target.classList.add('myst-inline-suggestion')
      target.style.setProperty('--myst-suggestion-color', blockSuggestions[0].authorColor)
      target.title = 'Select a change to review it; press F2 to suggest another edit.'
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
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'F2') return
    const target = event.target
    const suggestion = target instanceof Element
      ? target.closest<HTMLElement>('[data-myst-suggestion-id]')
      : null
    if (
      suggestion?.dataset.mystSuggestionId &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
      onSuggestionClick?.(suggestion.dataset.mystSuggestionId)
      return
    }
    if (!(target instanceof HTMLElement) || !target.matches('[data-myst-edit-id]')) return
    event.preventDefault()
    beginEditing(target)
  }

  const cancelEditing = () => setActiveEdit(null)

  const normalizeVisualDraft = (draft: string) => activeEdit?.block.kind === 'heading'
    ? draft.trim()
    : draft

  const applyLiveEditing = (draft: string) => {
    if (!activeEdit || !onCommitEdit || !onBeginEdit) return
    const replacement = normalizeVisualDraft(draft)
    if (activeEdit.block.kind === 'heading' && !replacement) {
      setActiveEdit((current) => current
        ? { ...current, error: 'A heading cannot be empty.' }
        : current)
      return
    }
    const result = onCommitEdit(activeEdit.anchor, replacement)
    if (result !== 'applied') {
      setActiveEdit((current) => current
        ? {
            ...current,
            error: result === 'conflict'
              ? 'This block changed elsewhere. Close and reopen it before editing.'
              : 'Visual editing is no longer available for this document.',
          }
        : current)
      return
    }
    const nextBlock = {
      ...activeEdit.block,
      to: activeEdit.block.from + replacement.length,
      value: replacement,
    }
    const nextAnchor = onBeginEdit(nextBlock)
    setActiveEdit((current) => current
      ? nextAnchor
        ? { ...current, anchor: nextAnchor, block: nextBlock, error: null }
        : { ...current, block: nextBlock, error: 'The live block could not be re-anchored.' }
      : current)
  }

  const commitEditing = (draft: string) => {
    if (!activeEdit || !onCommitEdit) return
    if (liveEditing) {
      setActiveEdit(null)
      return
    }
    const replacement = normalizeVisualDraft(draft)
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
          onChange={liveEditing ? applyLiveEditing : undefined}
          onRequestCitation={(insert) => onRequestCitation?.(insert)}
          onSave={commitEditing}
        />,
        activeEdit.target,
      )}
    </>
  )
})
