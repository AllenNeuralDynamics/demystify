import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type * as Yjs from 'yjs'
import { LocalYjsPersistence, PostgresYjsPersistence } from './database.js'

const require = createRequire(import.meta.url)
const yjs = require('yjs') as typeof Yjs

describe('LocalYjsPersistence', () => {
  it('normalizes and restores a persisted CRLF room', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-leveldb-test-'))
    const persistence = new LocalYjsPersistence(join(directory, 'yjs'))
    const roomName = 'crlf-room'
    const persistedDocument = new yjs.Doc()
    const document = new yjs.Doc()

    try {
      persistedDocument.getText('content').insert(0, 'alpha\r\nbeta\r\n')
      await persistence.provider.storeUpdate(
        roomName,
        yjs.encodeStateAsUpdate(persistedDocument),
      )

      persistence.bindState(roomName, document)
      await persistence.waitForHydration(document)
      document.getText('content').insert(6, 'X')
      await persistence.writeState(roomName, document)

      const restoredDocument = await persistence.provider.getYDoc(roomName)
      expect(restoredDocument.getText('content').toString()).toBe(
        'alpha\nXbeta\n',
      )
      expect(restoredDocument.getMap('metadata').get('lineEnding')).toBe('crlf')
      restoredDocument.destroy()
    } finally {
      persistedDocument.destroy()
      document.destroy()
      await persistence.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('PostgresYjsPersistence', () => {
  it('fails closed when a document was not registered for hydration', async () => {
    const persistence = new PostgresYjsPersistence({} as Pool)
    const document = new yjs.Doc()

    await expect(persistence.waitForHydration(document)).rejects.toThrow(
      'not registered for PostgreSQL hydration',
    )
    document.destroy()
  })

  it('does not report a room ready before hydration completes', async () => {
    let finishHydration!: (result: { rows: [] }) => void
    const hydration = new Promise<{ rows: [] }>((resolve) => {
      finishHydration = resolve
    })
    const persistence = new PostgresYjsPersistence({
      query: vi.fn((statement: string) =>
        statement.includes('SELECT update_data')
          ? hydration
          : Promise.resolve({ rows: [] }),
      ),
    } as unknown as Pool)
    const document = new yjs.Doc()
    let ready = false

    persistence.bindState('test-room', document)
    const waiting = persistence.waitForHydration(document).then(() => {
      ready = true
    })
    await Promise.resolve()

    expect(ready).toBe(false)
    finishHydration({ rows: [] })
    await waiting
    expect(ready).toBe(true)
    document.destroy()
  })

  it('normalizes persisted CRLF before reporting the room ready', async () => {
    const persistedDocument = new yjs.Doc()
    persistedDocument.getText('content').insert(0, 'alpha\r\nbeta\r\n')
    const persistence = new PostgresYjsPersistence({
      query: vi.fn((statement: string) =>
        statement.includes('SELECT update_data')
          ? Promise.resolve({
              rows: [
                {
                  update_data: Buffer.from(
                    yjs.encodeStateAsUpdate(persistedDocument),
                  ),
                },
              ],
            })
          : Promise.resolve({ rows: [] }),
      ),
    } as unknown as Pool)
    const document = new yjs.Doc()

    persistence.bindState('test-room', document)
    await persistence.waitForHydration(document)

    expect(document.getText('content').toString()).toBe('alpha\nbeta\n')
    expect(document.getMap('metadata').get('lineEnding')).toBe('crlf')
    persistedDocument.destroy()
    document.destroy()
  })

  it('waits for hydration before compacting a room', async () => {
    let finishHydration!: (result: { rows: [] }) => void
    const hydration = new Promise<{ rows: [] }>((resolve) => {
      finishHydration = resolve
    })
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }
    const connect = vi.fn().mockResolvedValue(client)
    const query = vi.fn((statement: string) =>
      statement.includes('SELECT update_data')
        ? hydration
        : Promise.resolve({ rows: [] }),
    )
    const persistence = new PostgresYjsPersistence({
      connect,
      query,
    } as unknown as Pool)
    const document = new yjs.Doc()

    persistence.bindState('test-room', document)
    const compacted = persistence.writeState('test-room', document)
    await Promise.resolve()

    expect(connect).not.toHaveBeenCalled()
    finishHydration({ rows: [] })
    await compacted
    expect(connect).toHaveBeenCalledOnce()
    document.destroy()
  })

  it('does not compact when hydration fails', async () => {
    const connect = vi.fn()
    const persistence = new PostgresYjsPersistence({
      connect,
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as Pool)
    const document = new yjs.Doc()

    persistence.bindState('test-room', document)
    await persistence.writeState('test-room', document)

    expect(connect).not.toHaveBeenCalled()
    document.destroy()
  })

  it('rejects readiness when hydration fails', async () => {
    const persistence = new PostgresYjsPersistence({
      query: vi.fn().mockRejectedValue(new Error('database unavailable')),
    } as unknown as Pool)
    const document = new yjs.Doc()

    persistence.bindState('test-room', document)

    await expect(persistence.waitForHydration(document)).rejects.toThrow(
      'database unavailable',
    )
    document.destroy()
  })
})