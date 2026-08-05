import { createRequire } from 'node:module'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type * as Yjs from 'yjs'
import { PostgresYjsPersistence } from './database.js'

const require = createRequire(import.meta.url)
const yjs = require('yjs') as typeof Yjs

describe('PostgresYjsPersistence', () => {
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
})