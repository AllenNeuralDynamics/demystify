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
    to <= from ||
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
  const start = Y.createAbsolutePositionFromRelativePosition(anchor.start, document)
  const end = Y.createAbsolutePositionFromRelativePosition(anchor.end, document)
  if (!start || !end || start.type !== text || end.type !== text) return 'unavailable'

  const from = Math.min(start.index, end.index)
  const to = Math.max(start.index, end.index)
  if (text.toString().slice(from, to) !== anchor.expectedText) return 'conflict'

  document.transact(() => {
    text.delete(from, to - from)
    if (replacement) text.insert(from, replacement)
  })
  return 'applied'
}