import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'
import type { SharedComment } from '../hooks/useCollaboration'
import { createCommentAnchor, resolveCommentAnchor } from './commentAnchors'
import { createCollaborationRecovery, getVisualDraftsForRecovery,
  collaborationRecoveryKey, readVisualRecoveryDraft, writeVisualRecoveryDraft } from './collaborationRecovery'

describe('collaboration recovery', () => {
  it('keeps a fresh editing cache separate without deleting rejected browser recovery', async () => {
    const room = crypto.randomUUID()
    const originalKey = collaborationRecoveryKey(room, 'actor')
    const freshKey = collaborationRecoveryKey(room, 'actor', 'fresh-session')
    expect(originalKey).not.toBe(freshKey)
    expect(collaborationRecoveryKey(room, 'actor', 'fresh-session')).toBe(freshKey)
    const original = new Y.Doc()
    const originalStore = new IndexeddbPersistence(originalKey, original)
    await originalStore.whenSynced
    original.getText('content').insert(0, 'Rejected local source.')
    original.getMap('comments').set('local', { body: 'Unsent review' })
    await originalStore.get('flush')
    await originalStore.destroy()
    original.destroy()
    const fresh = new Y.Doc()
    const freshStore = new IndexeddbPersistence(freshKey, fresh)
    await freshStore.whenSynced
    expect(fresh.getText('content').toString()).toBe('')
    fresh.getText('content').insert(0, 'Saved server source.')
    await freshStore.get('flush')
    const retained = new Y.Doc()
    const retainedStore = new IndexeddbPersistence(originalKey, retained)
    await retainedStore.whenSynced
    expect(retained.getText('content').toString()).toBe('Rejected local source.')
    expect(retained.getMap('comments').get('local')).toEqual({ body: 'Unsent review' })
    await retainedStore.clearData()
    await freshStore.clearData()
    retained.destroy()
    fresh.destroy()
  })

  it('scopes unsubmitted Visual drafts by room, actor, file and browser tab storage', () => {
    const stored = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      key: (index: number) => Array.from(stored.keys())[index] ?? null,
      get length() { return stored.size },
    })
    try {
      const room = crypto.randomUUID()
      const key = JSON.stringify([room, 'actor-a', 'paper.md'])
      const otherFile = JSON.stringify([room, 'actor-a', 'methods.md'])
      const otherActor = JSON.stringify([room, 'actor-b', 'paper.md'])
      const freshSession = JSON.stringify([room, 'actor-a:session:fresh-session', 'paper.md'])
      const draft = { base: 'Original.', source: 'Unsubmitted edit.', suggestionMode: true }
      expect(writeVisualRecoveryDraft(key, draft)).toBe(true)
      writeVisualRecoveryDraft(otherFile, draft)
      writeVisualRecoveryDraft(otherActor, { ...draft, source: 'Private to another actor.' })
      writeVisualRecoveryDraft(freshSession, { ...draft, source: 'Fresh-session draft.' })
      expect(readVisualRecoveryDraft(key)).toEqual(draft)
      expect(getVisualDraftsForRecovery(key)).toEqual([
        { filePath: 'paper.md', ...draft }, { filePath: 'methods.md', ...draft },
      ])
      expect(getVisualDraftsForRecovery(freshSession)).toEqual([
        { filePath: 'paper.md', ...draft, source: 'Fresh-session draft.' },
      ])
      writeVisualRecoveryDraft(key, null)
      expect(readVisualRecoveryDraft(key)).toBeNull()
      expect(getVisualDraftsForRecovery(key)).toHaveLength(1)
      writeVisualRecoveryDraft(otherFile, null)
      writeVisualRecoveryDraft(otherActor, null)
      writeVisualRecoveryDraft(freshSession, null)
    } finally { vi.unstubAllGlobals() }
  })

  it('retains an in-memory downloadable draft when browser storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('Blocked') },
      setItem: () => { throw new Error('Blocked') }, removeItem: () => { throw new Error('Blocked') } })
    try {
      const key = JSON.stringify([crypto.randomUUID(), 'actor', 'paper.md'])
      const draft = { base: 'Before.', source: 'After.', suggestionMode: true }
      expect(writeVisualRecoveryDraft(key, draft)).toBe(false)
      expect(readVisualRecoveryDraft(key)).toEqual(draft)
      expect(getVisualDraftsForRecovery(key)).toEqual([{ filePath: 'paper.md', ...draft }])
      writeVisualRecoveryDraft(key, null)
    } finally { vi.unstubAllGlobals() }
  })

  it('retains unsent review data when the browser document is recreated', async () => {
    const key = `recovery-test-${crypto.randomUUID()}`
    const document = new Y.Doc()
    const persistence = new IndexeddbPersistence(key, document)
    await persistence.whenSynced
    document.getText('content').insert(0, 'Offline manuscript')
    document.getMap('comments').set('offline-comment', { body: 'Do not lose this comment' })
    await persistence.get('flush')
    await persistence.destroy()
    document.destroy()

    const restored = new Y.Doc()
    const restoredPersistence = new IndexeddbPersistence(key, restored)
    await restoredPersistence.whenSynced
    expect(restored.getText('content').toString()).toBe('Offline manuscript')
    expect(restored.getMap('comments').get('offline-comment')).toEqual({ body: 'Do not lose this comment' })
    await restoredPersistence.clearData()
    restored.destroy()
  })

  it('round-trips 24 unsent reviews and their exact anchors without changing the live document', () => {
    const document = new Y.Doc()
    const content = document.getText('content')
    content.insert(0, '# Draft\n\nRepeated claim.\n\nRepeated claim.\n\nFinal claim.')
    const working = document.getText('workingContent')
    working.insert(0, '# Working draft\n\nReviewer edits not sent to the server.')
    const comments = document.getMap<SharedComment>('comments')
    const from = content.toString().lastIndexOf('Repeated claim.')
    const to = from + 'Repeated claim.'.length
    for (let index = 0; index < 24; index++) {
      comments.set(`review-${index}`, {
        id: `review-${index}`,
        authorId: 'github:reviewer',
        authorName: 'Reviewer',
        authorColor: '#16705d',
        body: `Unsent review ${index}`,
        createdAt: '2026-10-09T19:00:00.000Z',
        resolved: index === 0,
        anchor: createCommentAnchor(content, from, to),
        ...(index % 2 === 0 ? {
          suggestion: {
            kind: 'replace' as const,
            filePath: 'index.md',
            before: 'Repeated claim.',
            after: `Revised claim ${index}.`,
            status: 'pending' as const,
          },
        } : {}),
      })
    }
    document.getMap('commentMessages').set('reply-1', {
      id: 'reply-1', threadId: 'review-1', body: 'Unsent reply',
    })
    const before = Y.encodeStateAsUpdate(document)
    const onUpdate = vi.fn()
    document.on('update', onUpdate)

    const backup = JSON.parse(JSON.stringify(createCollaborationRecovery(document, 'room-1')))
    expect(backup.counts).toEqual({ comments: 12, suggestions: 12, replies: 1 })
    expect(Object.keys(backup.document.comments)).toHaveLength(24)
    expect(backup.commentRanges['review-1']).toMatchObject({ from, to, quote: 'Repeated claim.' })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(Y.encodeStateAsUpdate(document)).toEqual(before)

    const restored = new Y.Doc()
    Y.applyUpdate(restored, Uint8Array.from(atob(backup.yjsStateBase64), (byte) => byte.charCodeAt(0)))
    const restoredContent = restored.getText('content')
    expect(restoredContent.toString()).toBe(content.toString())
    expect(restored.getText('workingContent').toString()).toBe(working.toString())
    expect(restored.getMap('comments').toJSON()).toEqual(comments.toJSON())
    const restoredComment = restored.getMap<SharedComment>('comments').get('review-1')!
    expect(resolveCommentAnchor(restored, restoredContent, restoredComment.anchor!))
      .toMatchObject({ from, to, quote: 'Repeated claim.' })
    restored.destroy()
    document.destroy()
  })

  it('preserves working-draft and orphaned anchors without guessing a replacement range', () => {
    const document = new Y.Doc()
    document.getText('content').insert(0, 'Accepted content.')
    const working = document.getText('workingContent')
    working.insert(0, 'Local working content.')
    const comment = {
      id: 'local', authorId: 'reviewer', authorName: 'Reviewer', authorColor: '#16705d',
      body: 'Only in this tab', createdAt: '2026-10-09T19:00:00.000Z', resolved: false,
      anchorTarget: 'working' as const,
      anchor: createCommentAnchor(working, 6, 13),
    }
    document.getMap('comments').set(comment.id, comment)
    const backup = createCollaborationRecovery(document, 'room-2')
    expect(backup.commentRanges.local).toMatchObject({ from: 6, to: 13, quote: 'working' })
    working.delete(6, 7)
    const deleted = createCollaborationRecovery(document, 'room-2')
    expect(deleted.commentRanges.local).toMatchObject({ orphaned: true })
    document.destroy()
  })
})