import * as Y from 'yjs'

export interface AwarenessCursor {
  anchor: Y.RelativePosition
  head: Y.RelativePosition
}

export interface CollaboratorCursorRange {
  from: number
  to: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isAwarenessCursor = (value: unknown): value is AwarenessCursor =>
  isRecord(value) && isRecord(value.anchor) && isRecord(value.head)

export const resolveCollaboratorCursor = (
  document: Y.Doc,
  cursor: unknown,
  preferredText: Y.Text,
  compatibleTexts: Y.Text[] = [],
): CollaboratorCursorRange | null => {
  if (!isAwarenessCursor(cursor)) return null

  try {
    const anchor = Y.createAbsolutePositionFromRelativePosition(cursor.anchor, document)
    const head = Y.createAbsolutePositionFromRelativePosition(cursor.head, document)
    if (!anchor || !head || anchor.type !== head.type) return null

    const usesPreferredText = anchor.type === preferredText
    const usesCompatibleText = compatibleTexts.includes(anchor.type as Y.Text) &&
      (anchor.type as Y.Text).toString() === preferredText.toString()
    if (!usesPreferredText && !usesCompatibleText) return null

    return {
      from: Math.min(anchor.index, head.index),
      to: Math.max(anchor.index, head.index),
    }
  } catch {
    return null
  }
}
