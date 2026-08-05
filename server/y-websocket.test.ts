import { createRequire } from 'node:module'
import type { Pool } from 'pg'
import { expect, it, vi } from 'vitest'
import type * as Yjs from 'yjs'
import { PostgresYjsPersistence } from './database.js'

const require = createRequire(import.meta.url)
const { docs, getYDoc, setPersistence } = require('y-websocket/bin/utils') as {
  docs: Map<string, Yjs.Doc>
  getYDoc: (roomName: string) => Yjs.Doc
  setPersistence: (persistence: PostgresYjsPersistence | null) => void
}

it('registers persistence hydration when y-websocket creates a room', async () => {
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
  const roomName = `hydration-contract-${crypto.randomUUID()}`
  let document: Yjs.Doc | null = null

  try {
    setPersistence(persistence)
    document = getYDoc(roomName)
    let ready = false
    const waiting = persistence.waitForHydration(document).then(() => {
      ready = true
    })
    await Promise.resolve()

    expect(ready).toBe(false)
    finishHydration({ rows: [] })
    await waiting
    expect(ready).toBe(true)
  } finally {
    setPersistence(null)
    docs.delete(roomName)
    document?.destroy()
  }
})