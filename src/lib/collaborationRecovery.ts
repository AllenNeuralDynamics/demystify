import * as Y from 'yjs'
import type { SharedComment } from '../hooks/useCollaboration'
import { resolveCommentAnchor } from './commentAnchors'

export interface VisualRecoveryDraft {
  base: string
  source: string
  suggestionMode: boolean
  object?: { anchor: string; head: string; position: number }
}

export const visualObjectDraftKey = (key: string) => {
  try {
    const scope: unknown = JSON.parse(key)
    if (Array.isArray(scope) && scope.length === 3) {
      return JSON.stringify([scope[0], scope[1], `${scope[2]}#object`])
    }
  } catch { return `${key}:object` }
  return `${key}:object`
}

const visualDraftPrefix = 'demystify.visual-draft:'
const visualDrafts = new Map<string, VisualRecoveryDraft>()

export const readVisualRecoveryDraft = (key: string): VisualRecoveryDraft | null => {
  try {
    const raw = sessionStorage.getItem(`${visualDraftPrefix}${key}`)
    if (!raw) return visualDrafts.get(key) ?? null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || !('base' in value) ||
      !('source' in value) || !('suggestionMode' in value) ||
      typeof value.base !== 'string' || typeof value.source !== 'string' ||
      typeof value.suggestionMode !== 'boolean') return null
    const object = 'object' in value ? value.object : undefined
    if (object !== undefined && (!object || typeof object !== 'object' ||
      !('anchor' in object) || typeof object.anchor !== 'string' ||
      !('head' in object) || typeof object.head !== 'string' ||
      !('position' in object) || typeof object.position !== 'number' ||
      !Number.isSafeInteger(object.position) || object.position < 0)) return null
    return { base: value.base, source: value.source, suggestionMode: value.suggestionMode,
      ...(object ? { object: object as NonNullable<VisualRecoveryDraft['object']> } : {}) }
  } catch {
    return visualDrafts.get(key) ?? null
  }
}

export const writeVisualRecoveryDraft = (key: string, draft: VisualRecoveryDraft | null) => {
  if (draft) visualDrafts.set(key, draft)
  else visualDrafts.delete(key)
  try {
    if (draft) sessionStorage.setItem(`${visualDraftPrefix}${key}`, JSON.stringify(draft))
    else sessionStorage.removeItem(`${visualDraftPrefix}${key}`)
    return true
  } catch {
    return false
  }
}

export const getVisualDraftsForRecovery = (key: string | undefined) => {
  if (!key) return []
  let scope: unknown
  try { scope = JSON.parse(key) } catch { return [] }
  if (!Array.isArray(scope) || scope.length !== 3) return []
  let keys = new Set(visualDrafts.keys())
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const stored = sessionStorage.key(index)
      if (stored?.startsWith(visualDraftPrefix)) keys.add(stored.slice(visualDraftPrefix.length))
    }
  } catch { keys = new Set(visualDrafts.keys()) }
  return Array.from(keys).flatMap((candidate) => {
    let candidateScope: unknown
    try { candidateScope = JSON.parse(candidate) } catch { return [] }
    if (!Array.isArray(candidateScope) || candidateScope.length !== 3 ||
      candidateScope[0] !== scope[0] || candidateScope[1] !== scope[1]) return []
    const draft = readVisualRecoveryDraft(candidate)
    return draft ? [{ filePath: candidateScope[2] as string, ...draft }] : []
  })
}

const encodeBytes = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const createCollaborationRecovery = (
  document: Y.Doc,
  roomName: string,
) => {
  const update = Y.encodeStateAsUpdate(document)
  const snapshot = new Y.Doc()
  try {
    for (const name of ['content', 'workingContent', 'bibliography', 'mystConfig']) {
      snapshot.getText(name)
    }
    for (const name of [
      'comments', 'commentMessages', 'projectFiles', 'references',
      'proposalContributors', 'proposalHistory', 'metadata',
    ]) snapshot.getMap(name)
    Y.applyUpdate(snapshot, update)

    const comments = Array.from(snapshot.getMap<SharedComment>('comments').values())
    const anchorTexts = [
      snapshot.getText('content'),
      snapshot.getText('workingContent'),
      ...snapshot.getMap<Y.Text>('projectFiles').values(),
    ]
    const ranges = Object.fromEntries(comments.map((comment) => [
      comment.id,
      comment.anchor
        ? anchorTexts.map((text) => resolveCommentAnchor(snapshot, text, comment.anchor!, {
            allowEmpty: comment.suggestion?.kind === 'insert',
            recoverQuote: false,
          })).find((range) => range !== null) ?? null
        : null,
    ]))

    return {
      format: 'demystify-room-recovery',
      version: 1,
      exportedAt: new Date().toISOString(),
      roomName,
      yjsStateBase64: encodeBytes(update),
      document: snapshot.toJSON() as Record<string, unknown>,
      commentRanges: ranges,
      counts: {
        comments: comments.filter((comment) => !comment.suggestion).length,
        suggestions: comments.filter((comment) => comment.suggestion).length,
        replies: snapshot.getMap('commentMessages').size,
      },
    }
  } finally {
    snapshot.destroy()
  }
}