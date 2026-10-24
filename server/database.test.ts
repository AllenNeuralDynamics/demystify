import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type * as Yjs from 'yjs'
import {
  createDatabasePool,
  createPostgresSessionStore,
  databaseQueryTimeoutMs,
  databaseStatementTimeoutMs,
  LocalYjsPersistence,
  PostgresYjsPersistence,
} from './database.js'

const require = createRequire(import.meta.url)
const yjs = require('yjs') as typeof Yjs

describe('createDatabasePool', () => {
  it('bounds connection, statement, and client query waits', async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL
    const originalHost = process.env.PGHOST
    delete process.env.DATABASE_URL
    process.env.PGHOST = '127.0.0.1'

    try {
      const pool = createDatabasePool()
      expect(pool?.options).toMatchObject({
        connectionTimeoutMillis: 10_000,
        statement_timeout: databaseStatementTimeoutMs,
        query_timeout: databaseQueryTimeoutMs,
      })
      await pool?.end()
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = originalDatabaseUrl
      if (originalHost === undefined) delete process.env.PGHOST
      else process.env.PGHOST = originalHost
    }
  })
})

describe('createPostgresSessionStore', () => {
  it('initializes the session table before returning the store', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ to_regclass: null }] })
      .mockResolvedValue({ rows: [] })

    const store = await createPostgresSessionStore({ query } as unknown as Pool)
    const statements = query.mock.calls.map(([statement]) => statement as string)

    expect(statements).toEqual(expect.arrayContaining([
      expect.stringContaining('CREATE TABLE "demystify_sessions"'),
      expect.stringContaining('SELECT sess FROM "demystify_sessions"'),
    ]))
    expect(statements.findIndex((statement) => statement.includes('CREATE TABLE')))
      .toBeLessThan(statements.findIndex((statement) => statement.includes('SELECT sess')))
    await store.close()
  })
})

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

  it('waits for pending update writes before compacting a room', async () => {
    let finishWrite!: (result: { rows: [] }) => void
    const pendingWrite = new Promise<{ rows: [] }>((resolve) => {
      finishWrite = resolve
    })
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }
    const connect = vi.fn().mockResolvedValue(client)
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const persistence = new PostgresYjsPersistence({ connect, query } as unknown as Pool)
    const document = new yjs.Doc()
    persistence.bindState('pending-write-room', document)
    await persistence.waitForHydration(document)

    query.mockReturnValueOnce(pendingWrite)
    document.getMap('comments').set('review-1', { body: 'Not yet stored' })
    const compacted = persistence.writeState('pending-write-room', document)
    try {
      await Promise.resolve()
      await Promise.resolve()
      expect(connect).not.toHaveBeenCalled()
    } finally {
      finishWrite({ rows: [] })
      await compacted
      document.destroy()
    }
    expect(connect).toHaveBeenCalledOnce()
  })

  it('retains failed updates until a persistence barrier retries them successfully', async () => {
    const updates: Uint8Array[] = []
    let available = true
    const query = vi.fn(async (statement: string, values: unknown[]) => {
      if (!available) throw new Error('database unavailable')
      if (statement.includes('INSERT INTO demystify_yjs_updates')) {
        updates.push(new Uint8Array(values[1] as Buffer))
      }
      return { rows: [] }
    })
    const persistence = new PostgresYjsPersistence({ query } as unknown as Pool)
    const document = new yjs.Doc()
    persistence.bindState('retry-room', document)
    await persistence.waitForHydration(document)
    available = false
    document.getMap('comments').set('review-1', { body: 'Survives database outage' })
    document.getText('content').insert(0, 'Manuscript')
    await expect(persistence.flush('retry-room', document)).rejects.toThrow('database unavailable')
    available = true
    await persistence.flush('retry-room', document)
    const restored = new yjs.Doc()
    updates.forEach((update) => yjs.applyUpdate(restored, update))
    expect(restored.getMap('comments').get('review-1')).toEqual({ body: 'Survives database outage' })
    expect(restored.getText('content').toString()).toBe('Manuscript')
    restored.destroy()
    document.destroy()
  })

  it('automatically retries a failed deletion without another client update', async () => {
    vi.useFakeTimers()
    const updates: Uint8Array[] = []
    let available = true
    const persistence = new PostgresYjsPersistence({
      query: vi.fn(async (statement: string, values: unknown[]) => {
        if (!available) throw new Error('database unavailable')
        if (statement.includes('INSERT INTO demystify_yjs_updates')) {
          updates.push(new Uint8Array(values[1] as Buffer))
        }
        return { rows: [] }
      }),
    } as unknown as Pool)
    const document = new yjs.Doc()
    const restored = new yjs.Doc()
    try {
      persistence.bindState('retry-delete-room', document)
      await persistence.waitForHydration(document)
      document.getText('content').insert(0, 'Remove this')
      await persistence.flush('retry-delete-room', document)
      available = false
      document.getText('content').delete(0, 7)
      await vi.advanceTimersByTimeAsync(0)
      available = true
      await vi.advanceTimersByTimeAsync(1_000)
      updates.forEach((update) => yjs.applyUpdate(restored, update))
      expect(restored.getText('content').toString()).toBe('this')
    } finally {
      document.destroy()
      restored.destroy()
      vi.useRealTimers()
    }
  })

  it('retries a failed final save without forgetting the room', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }
    const persistence = new PostgresYjsPersistence({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool)
    const document = new yjs.Doc()
    persistence.bindState('retry-final-save', document)
    await persistence.waitForHydration(document)
    client.query.mockRejectedValueOnce(new Error('commit unavailable'))
    await expect(persistence.writeState('retry-final-save', document)).rejects.toThrow('commit unavailable')
    await expect(persistence.writeState('retry-final-save', document)).resolves.toBeUndefined()
    expect(client.release).toHaveBeenCalledTimes(2)
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