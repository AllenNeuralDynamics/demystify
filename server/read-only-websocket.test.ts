import * as encoding from 'lib0/encoding'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  isCollaboratorWebSocketMessageAllowed,
  isEditorWebSocketMessageAllowed,
  isReadOnlyWebSocketMessageAllowed,
} from './read-only-websocket.js'

const collaboratorMessageAllowed = (
  data: Buffer,
  document: Y.Doc,
  actorId = 'reviewer-1',
) => isCollaboratorWebSocketMessageAllowed(data, document, {
  role: 'collaborator',
  actorId,
  actorName: actorId,
  ownedActorIds: [actorId],
})

const editorMessageAllowed = (
  data: Buffer,
  document: Y.Doc,
  actorId = 'github:42',
) => isEditorWebSocketMessageAllowed(data, document, {
  role: 'editor',
  actorId,
  actorName: 'Maintainer',
  ownedActorIds: [actorId],
})

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

const createSuggestion = (
  document: Y.Doc,
  id = 'suggestion-1',
  supersedes: string[] = [],
) => {
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
      ...(supersedes.length > 0 ? { supersedes } : {}),
      status: 'pending',
    },
  }
}

const createRangeSuggestion = (
  document: Y.Doc,
  input: {
    after: string
    authorName: string
    from: number
    id: string
    supersedes?: string[]
    to: number
  },
) => {
  const text = document.getText('content')
  const before = text.toString().slice(input.from, input.to)
  return {
    id: input.id,
    authorId: input.authorName.toLowerCase().replaceAll(' ', '-'),
    authorName: input.authorName,
    authorColor: '#a64b36',
    body: 'Suggested edit',
    createdAt: '2026-08-12T01:00:00.000Z',
    resolved: false,
    anchor: {
      version: 1,
      start: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, input.from, 0),
      ),
      end: encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(text, input.to, -1),
      ),
      quote: before,
    },
    suggestion: {
      kind: before ? input.after ? 'replace' : 'delete' : 'insert',
      filePath: 'manuscript.md',
      before,
      after: input.after,
      ...(input.supersedes ? { supersedes: input.supersedes } : {}),
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
  it('allows live working text, protects canonical text, and stamps its socket actor', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Accepted paragraph.')
    document.getMap('metadata').set('workingContentInitialized', true)
    const workingUpdate = updateMessage(document, (candidate) => {
      candidate.getText('workingContent').insert(8, ' live')
    })

    expect(collaboratorMessageAllowed(workingUpdate, document, 'reviewer-live')).toBe(true)
    expect(document.getMap('proposalContributors').get('reviewer-live')).toMatchObject({
      actorId: 'reviewer-live',
      name: 'reviewer-live',
    })
    expect(document.getText('content').toString()).toBe('Accepted paragraph.')
  })

  it('allows citation text but rejects bibliography and reference changes', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Accepted paragraph.')
    document.getMap('metadata').set('workingContentInitialized', true)
    const citationUpdate = updateMessage(document, (candidate) => {
      candidate.getText('workingContent').insert(
        candidate.getText('workingContent').length,
        ' {cite:p}`existing2024`',
      )
    })

    expect(collaboratorMessageAllowed(citationUpdate, document, 'citation-reviewer')).toBe(true)

    const referenceUpdate = updateMessage(document, (candidate) => {
      candidate.getMap('references').set('doi:10.1000/new', {
        id: 'doi:10.1000/new',
        key: 'new2024',
      })
      candidate.getText('bibliography').insert(0, '@article{new2024}\n')
    })

    expect(collaboratorMessageAllowed(referenceUpdate, document, 'citation-reviewer')).toBe(false)
  })

  it('migrates legacy pending proposer identity without attributing the initializer', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    document.getMap('comments').set('suggestion-1', createSuggestion(document))
    const migration = updateMessage(document, (candidate) => {
      candidate.getText('workingContent').insert(0, 'Proposed paragraph.')
      candidate.getMap('metadata').set('workingContentInitialized', true)
    })

    expect(collaboratorMessageAllowed(migration, document, 'migration-viewer')).toBe(true)
    expect(document.getMap('proposalContributors').get('reviewer-1')).toMatchObject({
      actorId: 'reviewer-1',
      name: 'Review Contributor',
    })
    expect(document.getMap('proposalContributors').has('migration-viewer')).toBe(false)
  })

  it('rejects new comments that impersonate another socket actor', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const update = updateMessage(document, (candidate) => {
      candidate.getMap('comments').set('comment-1', {
        id: 'comment-1',
        authorId: 'reviewer-1',
        authorName: 'Impersonated Reviewer',
        authorColor: '#a64b36',
        body: 'This identity is not mine.',
        createdAt: '2026-08-12T01:00:00.000Z',
        resolved: false,
      })
    })

    expect(collaboratorMessageAllowed(update, document, 'reviewer-2')).toBe(false)
  })

  it('allows only the original author to edit comment and reply bodies', () => {
    const document = new Y.Doc()
    document.getMap('comments').set('comment-1', {
      id: 'comment-1',
      authorId: 'reviewer-1',
      authorName: 'First Reviewer',
      authorColor: '#a64b36',
      body: 'Original comment.',
      createdAt: '2026-08-12T01:00:00.000Z',
      resolved: false,
    })
    document.getMap('commentMessages').set('message-1', {
      id: 'message-1',
      threadId: 'comment-1',
      authorId: 'reviewer-2',
      authorName: 'Second Reviewer',
      authorColor: '#27628d',
      body: 'Original reply.',
      createdAt: '2026-08-12T01:01:00.000Z',
    })
    const commentEdit = updateMessage(document, (candidate) => {
      const comments = candidate.getMap<Record<string, unknown>>('comments')
      comments.set('comment-1', {
        ...comments.get('comment-1'),
        body: 'Edited comment.',
        editedAt: '2026-08-12T01:02:00.000Z',
      })
    })
    const replyEdit = updateMessage(document, (candidate) => {
      const messages = candidate.getMap<Record<string, unknown>>('commentMessages')
      messages.set('message-1', {
        ...messages.get('message-1'),
        body: 'Edited reply.',
        editedAt: '2026-08-12T01:02:00.000Z',
      })
    })

    expect(collaboratorMessageAllowed(commentEdit, document, 'reviewer-1')).toBe(true)
    expect(collaboratorMessageAllowed(commentEdit, document, 'reviewer-2')).toBe(false)
    expect(editorMessageAllowed(commentEdit, document)).toBe(false)
    expect(collaboratorMessageAllowed(replyEdit, document, 'reviewer-2')).toBe(true)
    expect(collaboratorMessageAllowed(replyEdit, document, 'reviewer-1')).toBe(false)
    expect(editorMessageAllowed(replyEdit, document)).toBe(false)
  })

  it('preserves comment ownership when a share actor later signs in', () => {
    const document = new Y.Doc()
    document.getMap('comments').set('comment-1', {
      id: 'comment-1',
      authorId: 'share:original-session',
      authorName: 'Guest Reviewer',
      authorColor: '#a64b36',
      body: 'Original comment.',
      createdAt: '2026-08-12T01:00:00.000Z',
      resolved: false,
    })
    const edit = updateMessage(document, (candidate) => {
      const comments = candidate.getMap<Record<string, unknown>>('comments')
      comments.set('comment-1', {
        ...comments.get('comment-1'),
        body: 'Edited after sign-in.',
        editedAt: '2026-08-12T01:02:00.000Z',
      })
    })
    const actor = {
      role: 'collaborator' as const,
      actorId: 'github:42',
      actorName: 'Signed-in Reviewer',
      ownedActorIds: ['github:42', 'share:original-session'],
    }

    expect(isCollaboratorWebSocketMessageAllowed(edit, document, actor)).toBe(true)
  })

  it('stamps maintainer edits made in live Suggesting mode', () => {
    const document = new Y.Doc()
    document.getText('workingContent').insert(0, 'Working paragraph.')
    const update = updateMessage(document, (candidate) => {
      candidate.getText('workingContent').insert(0, 'Suggested ')
    })

    expect(editorMessageAllowed(update, document)).toBe(true)
    expect(document.getMap('proposalContributors').get('github:42')).toMatchObject({
      actorId: 'github:42',
      name: 'Maintainer',
    })
  })

  it('mirrors direct maintainer edits without proposal attribution', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Accepted paragraph.')
    const update = updateMessage(document, (candidate) => {
      candidate.getText('content').insert(0, 'Direct ')
    })

    expect(editorMessageAllowed(update, document)).toBe(true)
    expect(document.getText('workingContent').toString()).toBe('Direct Accepted paragraph.')
    expect(document.getMap('proposalContributors').size).toBe(0)
  })

  it('preserves working-text anchors outside a direct maintainer edit', () => {
    const document = new Y.Doc()
    const content = document.getText('content')
    const working = document.getText('workingContent')
    content.insert(0, 'Original intro. Stable suffix.')
    working.insert(0, 'Original intro. Stable suffix.')
    const suffixIndex = working.toString().indexOf('Stable suffix.')
    const relative = Y.createRelativePositionFromTypeIndex(working, suffixIndex)
    const update = updateMessage(document, (candidate) => {
      const candidateContent = candidate.getText('content')
      candidateContent.delete(0, 'Original'.length)
      candidateContent.insert(0, 'Revised')
    })

    expect(editorMessageAllowed(update, document)).toBe(true)
    const resolved = Y.createAbsolutePositionFromRelativePosition(relative, document)
    expect(resolved?.type).toBe(working)
    expect(working.toString().slice(resolved?.index)).toBe('Stable suffix.')
  })

  it('blocks direct canonical edits while a live proposal is pending', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Pending proposal.')
    const update = updateMessage(document, (candidate) => {
      candidate.getText('content').insert(0, 'Direct ')
    })

    expect(editorMessageAllowed(update, document)).toBe(false)
  })

  it('accepts a structurally valid attributed proposal checkpoint', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Proposed paragraph.')
    const contributor = {
      actorId: 'reviewer-1',
      name: 'Reviewer One',
      color: '#a64b36',
      firstEditedAt: '2026-08-12T01:00:00.000Z',
      lastEditedAt: '2026-08-12T01:01:00.000Z',
    }
    document.getMap('proposalContributors').set(contributor.actorId, contributor)
    const checkpoint = {
      id: 'checkpoint-1',
      before: 'Accepted paragraph.',
      after: 'Proposed paragraph.',
      contributors: [contributor],
      createdAt: contributor.firstEditedAt,
      decidedAt: '2026-08-12T01:02:00.000Z',
      decidedById: 'github:42',
      decidedByName: 'Maintainer',
      status: 'accepted',
    }
    const update = updateMessage(document, (candidate) => {
      const content = candidate.getText('content')
      content.delete(0, content.length)
      content.insert(0, checkpoint.after)
      candidate.getMap('proposalContributors').clear()
      candidate.getMap('proposalHistory').set(checkpoint.id, checkpoint)
    })

    expect(editorMessageAllowed(update, document)).toBe(true)
  })

  it('accepts rejection only when working text resets to accepted source', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Proposed paragraph.')
    const contributor = {
      actorId: 'reviewer-1',
      name: 'Reviewer One',
      color: '#a64b36',
      firstEditedAt: '2026-08-12T01:00:00.000Z',
      lastEditedAt: '2026-08-12T01:01:00.000Z',
    }
    document.getMap('proposalContributors').set(contributor.actorId, contributor)
    const checkpoint = {
      id: 'checkpoint-2',
      before: 'Accepted paragraph.',
      after: 'Proposed paragraph.',
      contributors: [contributor],
      createdAt: contributor.firstEditedAt,
      decidedAt: '2026-08-12T01:02:00.000Z',
      decidedById: 'github:42',
      decidedByName: 'Maintainer',
      status: 'rejected',
    }
    const valid = updateMessage(document, (candidate) => {
      const working = candidate.getText('workingContent')
      working.delete(0, working.length)
      working.insert(0, checkpoint.before)
      candidate.getMap('proposalContributors').clear()
      candidate.getMap('proposalHistory').set(checkpoint.id, checkpoint)
    })
    const invalid = updateMessage(document, (candidate) => {
      candidate.getMap('proposalContributors').clear()
      candidate.getMap('proposalHistory').set(checkpoint.id, checkpoint)
    })

    expect(editorMessageAllowed(valid, document)).toBe(true)
    expect(editorMessageAllowed(invalid, document)).toBe(false)
  })

  it('rejects malformed checkpoint attribution and direct edits with contributors', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted paragraph.')
    document.getText('workingContent').insert(0, 'Accepted paragraph.')
    document.getMap('proposalContributors').set('reviewer-1', {
      actorId: 'reviewer-1',
      name: 'Reviewer One',
      color: '#a64b36',
      firstEditedAt: '2026-08-12T01:00:00.000Z',
      lastEditedAt: '2026-08-12T01:01:00.000Z',
    })
    const directEdit = updateMessage(document, (candidate) => {
      candidate.getText('content').insert(0, 'Direct ')
    })
    const malformed = updateMessage(document, (candidate) => {
      candidate.getText('workingContent').insert(0, 'Proposed ')
      candidate.getMap('proposalContributors').clear()
      candidate.getMap('proposalHistory').set('checkpoint-bad', {
        id: 'checkpoint-bad',
        before: 'Accepted paragraph.',
        after: 'Proposed Accepted paragraph.',
        contributors: [],
        createdAt: 'invalid',
        decidedAt: 'invalid',
        decidedById: 'someone-else',
        decidedByName: 'Impostor',
        status: 'rejected',
      })
    })

    expect(editorMessageAllowed(directEdit, document)).toBe(false)
    expect(editorMessageAllowed(malformed, document)).toBe(false)
  })

  it('allows a one-time Git link on an immutable accepted checkpoint', () => {
    const document = new Y.Doc()
    const checkpoint = {
      id: 'checkpoint-linked',
      before: 'Before.',
      after: 'After.',
      contributors: [],
      createdAt: '2026-08-12T01:00:00.000Z',
      decidedAt: '2026-08-12T01:01:00.000Z',
      decidedById: 'github:42',
      decidedByName: 'Maintainer',
      status: 'accepted',
    }
    document.getMap('proposalHistory').set(checkpoint.id, checkpoint)
    const link = updateMessage(document, (candidate) => {
      candidate.getMap('proposalHistory').set(checkpoint.id, {
        ...checkpoint,
        commitSha: 'abcdef1234567890',
        submittedAt: '2026-08-12T01:02:00.000Z',
      })
    })
    const rewrite = updateMessage(document, (candidate) => {
      candidate.getMap('proposalHistory').set(checkpoint.id, {
        ...checkpoint,
        status: 'rejected',
      })
    })

    expect(editorMessageAllowed(link, document)).toBe(true)
    expect(editorMessageAllowed(rewrite, document)).toBe(false)
  })

  it('allows presence, sync requests, and a valid pending suggestion', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const suggestionUpdate = updateMessage(document, (candidate) => {
      candidate.getMap('comments').set('suggestion-1', createSuggestion(candidate))
    })

    expect(collaboratorMessageAllowed(message(1), document)).toBe(true)
    expect(collaboratorMessageAllowed(message(0, 0), document)).toBe(true)
    expect(collaboratorMessageAllowed(suggestionUpdate, document)).toBe(true)
    document.destroy()
  })

  it('allows source-fragment, insertion, and successive alternatives', () => {
    const document = new Y.Doc()
    const source = '# Draft\n\nA manuscript should be inspectable.\n'
    document.getText('content').insert(0, source)
    const from = source.indexOf('inspectable')
    const to = from + 'inspectable'.length
    const first = createRangeSuggestion(document, {
      id: 'source-suggestion-1',
      authorName: 'First Reviewer',
      from,
      to,
      after: 'reviewable',
    })
    const firstUpdate = updateMessage(document, (candidate) => {
      candidate.getMap('comments').set(first.id, first)
    })
    expect(collaboratorMessageAllowed(firstUpdate, document, 'first-reviewer')).toBe(true)
    Y.applyUpdate(document, (() => {
      const candidate = new Y.Doc()
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
      const stateVector = Y.encodeStateVector(document)
      candidate.getMap('comments').set(first.id, first)
      const update = Y.encodeStateAsUpdate(candidate, stateVector)
      candidate.destroy()
      return update
    })())

    const second = createRangeSuggestion(document, {
      id: 'source-suggestion-2',
      authorName: 'Second Reviewer',
      from,
      to,
      after: 'reviewable and attributed',
      supersedes: [first.id],
    })
    const insertion = createRangeSuggestion(document, {
      id: 'source-insertion-1',
      authorName: 'Third Reviewer',
      from: source.length,
      to: source.length,
      after: '\nInserted proposal.',
    })
    expect(collaboratorMessageAllowed(updateMessage(document, (candidate) => {
      candidate.getMap('comments').set(second.id, second)
    }), document, 'second-reviewer')).toBe(true)
    expect(collaboratorMessageAllowed(updateMessage(document, (candidate) => {
      candidate.getMap('comments').set(insertion.id, insertion)
    }), document, 'third-reviewer')).toBe(true)
    document.destroy()
  })

  it('blocks revision lineage that does not reference a matching pending suggestion', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Original paragraph.')
    const suggestion = createSuggestion(
      document,
      'suggestion-2',
      ['missing-suggestion'],
    )

    expect(collaboratorMessageAllowed(updateMessage(document, (candidate) => {
      candidate.getMap('comments').set('suggestion-2', suggestion)
    }), document)).toBe(false)
    document.destroy()
  })

  it('allows a paragraph revision to supersede a contained source fragment', () => {
    const document = new Y.Doc()
    const source = 'The live preview remains inspectable.'
    document.getText('content').insert(0, source)
    const fragmentFrom = source.indexOf('preview')
    const fragment = createRangeSuggestion(document, {
      id: 'fragment-suggestion',
      authorName: 'Source Reviewer',
      from: fragmentFrom,
      to: fragmentFrom + 'preview'.length,
      after: 'browser preview',
    })
    document.getMap('comments').set(fragment.id, fragment)
    const paragraph = createRangeSuggestion(document, {
      id: 'paragraph-revision',
      authorName: 'Visual Reviewer',
      from: 0,
      to: source.length,
      after: 'The live browser preview remains directly editable.',
      supersedes: [fragment.id],
    })

    expect(collaboratorMessageAllowed(updateMessage(document, (candidate) => {
      candidate.getMap('comments').set(paragraph.id, paragraph)
    }), document, 'visual-reviewer')).toBe(true)
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

    expect(collaboratorMessageAllowed(reviewUpdate, document, 'reviewer-2')).toBe(true)
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

    expect(collaboratorMessageAllowed(sourceUpdate, document)).toBe(false)
    expect(collaboratorMessageAllowed(mixedUpdate, document)).toBe(false)
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

    expect(collaboratorMessageAllowed(decisionUpdate, document)).toBe(false)
    document.destroy()
  })
})