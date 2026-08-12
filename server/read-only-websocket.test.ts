import * as encoding from 'lib0/encoding'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  isCollaboratorWebSocketMessageAllowed,
  isReadOnlyWebSocketMessageAllowed,
} from './read-only-websocket.js'

const message = (type: number, subtype?: number) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  if (subtype !== undefined) encoding.writeVarUint(encoder, subtype)
  return Buffer.from(encoding.toUint8Array(encoder))
}

const updateMessage = (
  document: Y.Doc,
  mutate: (candidate: Y.Doc) => void,
) => {
  const candidate = new Y.Doc()
  Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
  const stateVector = Y.encodeStateVector(document)
  mutate(candidate)
  const update = Y.encodeStateAsUpdate(candidate, stateVector)
  candidate.destroy()
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  encoding.writeVarUint(encoder, 2)
  encoding.writeVarUint8Array(encoder, update)
  return Buffer.from(encoding.toUint8Array(encoder))
}

const encodeRelativePosition = (position: Y.RelativePosition) =>
  Buffer.from(Y.encodeRelativePosition(position)).toString('base64')

const createSuggestion = (document: Y.Doc, id = 'suggestion-1') => {
  const text = document.getText('content')
  return {
    id,
    authorId: 'reviewer-1',
    authorName: 'Review Contributor',
    authorColor: '#a64b36',
    body: 'Suggested edit',
    createdAt: '2026-08-12T01:00:00.000Z',
    resolved: false,
    anchor: {
      version: 1,
      start: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 0, 0)),
      end: encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, text.length, -1)),
      quote: text.toString(),
    },
    suggestion: {
      kind: 'replace',
      filePath: 'paper.md',
      before: text.toString(),
      after: 'Proposed paragraph.',
      status: 'pending',
    },
  }
}

describe('read-only Yjs messages', () => {
  it('allows presence and sync requests needed to load the room', () => {
    expect(isReadOnlyWebSocketMessageAllowed(message(1))).toBe(true)
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 0))).toBe(true)
  })

  it('blocks sync responses, document updates, and unknown messages', () => {
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 1))).toBe(false)
    expect(isReadOnlyWebSocketMessageAllowed(message(0, 2))).toBe(false)
    expect(isReadOnlyWebSocketMessageAllowed(message(9))).toBe(false)
  })
})

describe('suggestion-mode Yjs messages', () => {
  it('allows presence, sync requests, and a valid pending suggestion', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const suggestionUpdate = updateMessage(document, (candidate) => {
      candidate.getMap('comments').set('suggestion-1', createSuggestion(candidate))
    })

    expect(isCollaboratorWebSocketMessageAllowed(message(1), document)).toBe(true)
    expect(isCollaboratorWebSocketMessageAllowed(message(0, 0), document)).toBe(true)
    expect(isCollaboratorWebSocketMessageAllowed(suggestionUpdate, document)).toBe(true)
    document.destroy()
  })

  it('allows replies and ordinary comment resolution', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    document.getMap('comments').set('comment-1', {
      id: 'comment-1',
      authorId: 'reviewer-1',
      authorName: 'Review Contributor',
      authorColor: '#a64b36',
      body: 'Please clarify.',
      createdAt: '2026-08-12T01:00:00.000Z',
      resolved: false,
    })
    const reviewUpdate = updateMessage(document, (candidate) => {
      const comments = candidate.getMap<Record<string, unknown>>('comments')
      const comment = comments.get('comment-1')
      comments.set('comment-1', { ...comment, resolved: true })
      candidate.getMap('commentMessages').set('message-1', {
        id: 'message-1',
        threadId: 'comment-1',
        authorId: 'reviewer-2',
        authorName: 'Second Reviewer',
        authorColor: '#27628d',
        body: 'Agreed.',
        createdAt: '2026-08-12T01:01:00.000Z',
      })
    })

    expect(isCollaboratorWebSocketMessageAllowed(reviewUpdate, document)).toBe(true)
    document.destroy()
  })

  it('blocks source updates even when bundled with a valid suggestion', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const sourceUpdate = updateMessage(document, (candidate) => {
      candidate.getText('content').insert(0, 'Unauthorized. ')
    })
    const mixedUpdate = updateMessage(document, (candidate) => {
      candidate.getText('content').insert(0, 'Unauthorized. ')
      candidate.getMap('comments').set('suggestion-1', createSuggestion(candidate))
    })

    expect(isCollaboratorWebSocketMessageAllowed(sourceUpdate, document)).toBe(false)
    expect(isCollaboratorWebSocketMessageAllowed(mixedUpdate, document)).toBe(false)
    document.destroy()
  })

  it('blocks contributor-authored suggestion decisions and record rewrites', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const suggestion = createSuggestion(document)
    document.getMap('comments').set('suggestion-1', suggestion)
    const decisionUpdate = updateMessage(document, (candidate) => {
      const comments = candidate.getMap<Record<string, unknown>>('comments')
      const comment = comments.get('suggestion-1')
      comments.set('suggestion-1', {
        ...comment,
        resolved: true,
        suggestion: {
          ...(comment?.suggestion as Record<string, unknown>),
          status: 'accepted',
          decidedByName: 'Review Contributor',
        },
      })
    })

    expect(isCollaboratorWebSocketMessageAllowed(decisionUpdate, document)).toBe(false)
    document.destroy()
  })
})