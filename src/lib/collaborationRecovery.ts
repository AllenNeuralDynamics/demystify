import * as Y from 'yjs'
import type { SharedComment } from '../hooks/useCollaboration'
import { resolveCommentAnchor } from './commentAnchors'

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