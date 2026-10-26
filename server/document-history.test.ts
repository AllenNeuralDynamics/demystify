import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as Yjs from 'yjs'
import { describe, expect, it, vi } from 'vitest'
import { LocalYjsPersistence } from './database.js'
import { DocumentHistory, historyRoomKey } from './document-history.js'
import { validateRoomName } from './rooms.js'

const require = createRequire(import.meta.url)
const Y = require('yjs') as typeof Yjs

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demystify-history-'))
  const persistence = new LocalYjsPersistence(join(directory, 'yjs'))
  const document = new Y.Doc()
  persistence.bindState('history-test', document)
  await persistence.waitForHydration(document)
  document.transact(() => {
    document.getText('content').insert(0, 'Original paragraph. Stable suffix.')
    document.getText('workingContent').insert(0, 'Original paragraph. Stable suffix.')
    document.getText('bibliography').insert(0, '@article{original}\n')
    document.getMap('metadata').set('initialized', true)
    document.getMap('metadata').set('workingContentInitialized', true)
  })
  const history = new DocumentHistory(persistence, { idleMilliseconds: 5, maximumMilliseconds: 20,
    actor: () => ({ id: 'writer', name: 'Writer' }) })
  return { persistence, document, history, close: async () => {
    await history.release('history-test')
    document.destroy()
    await persistence.destroy()
    await rm(directory, { recursive: true, force: true })
  } }
}

describe('durable manuscript history', () => {
  it('uses a private persistence key that cannot be joined as a collaboration room', () => {
    const key = historyRoomKey('room-name'.repeat(10))
    expect(key.length).toBeLessThanOrEqual(100)
    expect(() => validateRoomName(key)).toThrow()
  })

  it('persists named and automatic checkpoints across history-service reloads', async () => {
    const { history, document, persistence, close } = await fixture()
    try {
      const first = await history.checkpoint('history-test', document, 'named', { id: 'writer', name: 'Writer' }, 'Before review')
      await history.checkpoint('history-test', document)
      expect((await history.list('history-test', document)).versions).toHaveLength(1)
      await history.release('history-test')
      const reloaded = new DocumentHistory(persistence)
      const preview = await reloaded.preview('history-test', document, first!.id)
      expect(preview.version.name).toBe('Before review')
      expect(preview.snapshot.content).toBe('Original paragraph. Stable suffix.')
      expect(preview.snapshot.bibliography).toContain('@article{original}')
      await reloaded.release('history-test')
    } finally { await close() }
  })

  it('captures room edits automatically without a GitHub snapshot', async () => {
    const { history, document, persistence, close } = await fixture()
    try {
      history.track('history-test', document)
      document.getText('workingContent').insert(0, 'Proposed ')
      await vi.waitFor(async () => {
        const persisted = await persistence.provider.getYDoc(historyRoomKey('history-test'))
        try { expect(persisted.getMap('versions').size).toBe(1) }
        finally { persisted.destroy() }
      })
      const versions = await history.list('history-test', document)
      expect(versions.versions[0].kind).toBe('automatic')
      expect(versions.versions[0].authors).toEqual([{ id: 'writer', name: 'Writer' }])
    } finally { await close() }
  })

  it('restores through a new checkpoint, preserving the draft, comments, history and stable anchors', async () => {
    const { history, document, close } = await fixture()
    try {
      document.getMap<Yjs.Text>('projectFiles').set('methods.md', new Y.Text('Original methods.'))
      document.getMap('references').set('original', { id: 'original', bibtex: '@article{original}\n' })
      document.getText('mystConfig').insert(0, 'version: 1\n')
      const original = await history.checkpoint('history-test', document, 'named', { id: 'writer', name: 'Writer' }, 'Original')
      const content = document.getText('content')
      const suffix = Y.createRelativePositionFromTypeIndex(content, content.toString().indexOf('Stable suffix.'))
      document.getMap('comments').set('comment', { body: 'Retained comment', resolved: false })
      document.getMap('proposalHistory').set('review', { status: 'accepted' })
      content.insert(0, 'Latest ')
      document.getText('workingContent').insert(0, 'Latest ')
      document.getText('bibliography').insert(0, '@article{latest}\n')
      document.getMap('metadata').set('roomTitle', 'Latest room name')
      document.getMap<Yjs.Text>('projectFiles').get('methods.md')!.insert(0, 'Latest ')
      document.getMap('references').set('latest', { id: 'latest', bibtex: '@article{latest}\n' })
      const preview = await history.preview('history-test', document, original!.id)
      await history.restore('history-test', document, original!.id, preview.revision, { id: 'writer', name: 'Writer' })
      expect(content.toString()).toBe('Original paragraph. Stable suffix.')
      expect(document.getMap<Yjs.Text>('projectFiles').get('methods.md')!.toString()).toBe('Original methods.')
      expect(document.getMap('references').has('latest')).toBe(false)
      expect(document.getText('bibliography').toString()).toBe('@article{original}\n')
      expect(document.getText('mystConfig').toString()).toBe('version: 1\n')
      expect(document.getMap('metadata').get('roomTitle')).toBe('Latest room name')
      expect(document.getMap('comments').get('comment')).toEqual({ body: 'Retained comment', resolved: false })
      expect(document.getMap('proposalHistory').get('review')).toEqual({ status: 'accepted' })
      expect(Y.createAbsolutePositionFromRelativePosition(suffix, document)?.index).toBe('Original paragraph. '.length)
      const page = await history.list('history-test', document)
      expect(page.versions[0].kind).toBe('restore')
      const safety = page.versions.find((version) => version.kind === 'safety')!
      expect((await history.preview('history-test', document, safety.id)).snapshot.content).toContain('Latest ')
    } finally { await close() }
  })

  it('refuses restoration after an insertion or deletion following the preview', async () => {
    const { history, document, close } = await fixture()
    try {
      const version = await history.checkpoint('history-test', document, 'named', { id: 'writer', name: 'Writer' }, 'Original')
      const preview = await history.preview('history-test', document, version!.id)
      document.getText('content').delete(0, 1)
      await expect(history.restore('history-test', document, version!.id, preview.revision, { id: 'writer', name: 'Writer' }))
        .rejects.toThrow('The draft changed after this preview')
      expect(document.getText('content').toString()).toBe('riginal paragraph. Stable suffix.')
    } finally { await close() }
  })

  it('rechecks the draft after the safety checkpoint is persisted', async () => {
    const { history, document, persistence, close } = await fixture()
    let release!: () => void
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => { entered = resolve })
    const hold = new Promise<void>((resolve) => { release = resolve })
    let intercepted = false
    try {
      const original = await history.checkpoint('history-test', document, 'named', { id: 'writer', name: 'Writer' }, 'Original')
      document.getText('content').insert(0, 'Latest ')
      const preview = await history.preview('history-test', document, original!.id)
      const flush = persistence.flush.bind(persistence)
      vi.spyOn(persistence, 'flush').mockImplementation(async (key, source) => {
        if (key === historyRoomKey('history-test') && !intercepted) {
          intercepted = true
          entered()
          await hold
        }
        return flush(key, source)
      })
      const restore = history.restore('history-test', document, original!.id, preview.revision, { id: 'writer', name: 'Writer' })
      const rejected = expect(restore).rejects.toThrow('The draft changed after this preview')
      await waiting
      document.getText('content').insert(0, 'Concurrent ')
      release()
      await rejected
      expect(document.getText('content').toString()).toContain('Concurrent Latest ')
      const versions = await history.list('history-test', document)
      expect(versions.versions.some((version) => version.kind === 'safety')).toBe(true)
      expect(versions.versions.some((version) => version.kind === 'restore')).toBe(false)
    } finally { release?.(); await close() }
  })
})