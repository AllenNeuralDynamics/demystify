import * as Y from 'yjs'

export interface CollaborativeTextEditAnchor {
  start: Y.RelativePosition
  end: Y.RelativePosition
  expectedText: string
}

export type CollaborativeTextEditResult =
  | 'applied'
  | 'conflict'
  | 'unavailable'

export type CollaborativeTextEditResolution =
  | { from: number; to: number }
  | 'conflict'
  | 'unavailable'

export interface TextReplacement {
  from: number
  to: number
  before: string
  after: string
}

export const getTextReplacement = (
  source: string,
  draft: string,
): TextReplacement | null => {
  if (source === draft) return null
  let from = 0
  while (from < source.length && from < draft.length && source[from] === draft[from]) {
    from += 1
  }

  let sourceEnd = source.length
  let draftEnd = draft.length
  while (
    sourceEnd > from &&
    draftEnd > from &&
    source[sourceEnd - 1] === draft[draftEnd - 1]
  ) {
    sourceEnd -= 1
    draftEnd -= 1
  }

  return {
    from,
    to: sourceEnd,
    before: source.slice(from, sourceEnd),
    after: draft.slice(from, draftEnd),
  }
}

export const rebaseTextDraft = (
  base: string,
  draft: string,
  canonical: string,
): string | null => {
  const local = getTextReplacement(base, draft)
  if (!local) return canonical
  const remote = getTextReplacement(base, canonical)
  if (!remote) return draft

  const remoteBeforeLocal = remote.to <= local.from && !(
    remote.from === remote.to && remote.from === local.from
  )
  const remoteAfterLocal = remote.from >= local.to && !(
    local.from === local.to && remote.from === local.from
  )
  if (!remoteBeforeLocal && !remoteAfterLocal) return null

  const shift = remoteBeforeLocal
    ? remote.after.length - remote.before.length
    : 0
  const from = local.from + shift
  const to = local.to + shift
  if (canonical.slice(from, to) !== local.before) return null
  return `${canonical.slice(0, from)}${local.after}${canonical.slice(to)}`
}

export const createCollaborativeTextEditAnchor = (
  text: Y.Text,
  from: number,
  to: number,
  expectedText: string,
): CollaborativeTextEditAnchor | null => {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > text.length ||
    text.toString().slice(from, to) !== expectedText
  ) return null

  return {
    start: Y.createRelativePositionFromTypeIndex(text, from, 0),
    end: Y.createRelativePositionFromTypeIndex(text, to, -1),
    expectedText,
  }
}

export const applyCollaborativeTextEdit = (
  document: Y.Doc,
  text: Y.Text,
  anchor: CollaborativeTextEditAnchor,
  replacement: string,
): CollaborativeTextEditResult => {
  const resolution = resolveCollaborativeTextEditAnchor(document, text, anchor)
  if (typeof resolution === 'string') return resolution

  document.transact(() => {
    text.delete(resolution.from, resolution.to - resolution.from)
    if (replacement) text.insert(resolution.from, replacement)
  })
  return 'applied'
}

export const resolveCollaborativeTextEditAnchor = (
  document: Y.Doc,
  text: Y.Text,
  anchor: CollaborativeTextEditAnchor,
): CollaborativeTextEditResolution => {
  const start = Y.createAbsolutePositionFromRelativePosition(anchor.start, document)
  const end = Y.createAbsolutePositionFromRelativePosition(anchor.end, document)
  if (!start || !end || start.type !== text || end.type !== text) return 'unavailable'

  const from = Math.min(start.index, end.index)
  const to = Math.max(start.index, end.index)
  if (text.toString().slice(from, to) !== anchor.expectedText) return 'conflict'

  return { from, to }
}