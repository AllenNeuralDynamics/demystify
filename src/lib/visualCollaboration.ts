import * as Y from 'yjs'
import { getVisualDocumentChanges } from './visualDocument'

export const applyVisualSourceChanges = (
  text: Y.Text,
  before: string,
  after: string,
  origin: unknown,
) => {
  if (!text.doc || text.toString() !== before) return false
  const changes = getVisualDocumentChanges(before, after)
  text.doc.transact(() => {
    for (const change of [...changes].reverse()) {
      if (change.to > change.from) text.delete(change.from, change.to - change.from)
      if (change.after) text.insert(change.from, change.after)
    }
  }, origin)
  return true
}