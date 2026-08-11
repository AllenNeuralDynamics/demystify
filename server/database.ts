import { createRequire } from 'node:module'
import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import pg, { type Pool } from 'pg'
import type * as Yjs from 'yjs'

const require = createRequire(import.meta.url)
const Y = require('yjs') as typeof Yjs

interface LeveldbProvider {
  getYDoc(roomName: string): Promise<Yjs.Doc>
  storeUpdate(roomName: string, update: Uint8Array): Promise<number>
  flushDocument(roomName: string): Promise<void>
  destroy(): Promise<void>
}

const { LeveldbPersistence } = require('y-leveldb') as {
  LeveldbPersistence: new (location: string) => LeveldbProvider
}

export interface ReadyYjsPersistence {
  readonly provider: unknown
  bindState(roomName: string, document: Yjs.Doc): void
  waitForHydration(document: Yjs.Doc): Promise<void>
  writeState(roomName: string, document: Yjs.Doc): Promise<void>
}

const normalizePersistedSource = (document: Yjs.Doc, origin: unknown) => {
  const text = document.getText('content')
  const source = text.toString()
  if (!source.includes('\r')) return false

  const metadata = document.getMap<string | number | boolean>('metadata')
  const firstLineEnding = source.match(/\r\n|\r/)?.[0]
  const normalized = source.replace(/\r\n?|\n/g, '\n')
  document.transact(
    () => {
      text.delete(0, text.length)
      text.insert(0, normalized)
      if (!metadata.get('lineEnding')) {
        metadata.set('lineEnding', firstLineEnding === '\r\n' ? 'crlf' : 'cr')
      }
    },
    origin,
  )
  return true
}

export class LocalYjsPersistence implements ReadyYjsPersistence {
  readonly provider: LeveldbProvider
  private readonly persistenceOrigin = Symbol('leveldb-yjs-persistence')
  private readonly hydrations = new WeakMap<Yjs.Doc, Promise<void>>()
  private readonly pendingWrites = new WeakMap<Yjs.Doc, Set<Promise<number>>>()

  constructor(location: string) {
    this.provider = new LeveldbPersistence(location)
  }

  bindState = (roomName: string, document: Yjs.Doc) => {
    const hydration = this.hydrate(roomName, document)
    this.hydrations.set(document, hydration)
    void hydration.catch((error: unknown) => {
      console.error(`Could not hydrate local Yjs room ${roomName}:`, error)
    })
  }

  waitForHydration = async (document: Yjs.Doc) => {
    const hydration = this.hydrations.get(document)
    if (!hydration) {
      throw new Error('The Yjs document was not registered for LevelDB hydration.')
    }
    await hydration
  }

  writeState = async (roomName: string, document: Yjs.Doc) => {
    try {
      await this.waitForHydration(document)
    } catch {
      this.hydrations.delete(document)
      return
    }

    await Promise.all(this.pendingWrites.get(document) ?? [])
    await this.provider.storeUpdate(roomName, Y.encodeStateAsUpdate(document))
    await this.provider.flushDocument(roomName)
    this.pendingWrites.delete(document)
    this.hydrations.delete(document)
  }

  destroy = () => this.provider.destroy()

  private async hydrate(roomName: string, document: Yjs.Doc) {
    const persistedDocument = await this.provider.getYDoc(roomName)
    try {
      Y.applyUpdate(
        document,
        Y.encodeStateAsUpdate(persistedDocument),
        this.persistenceOrigin,
      )
    } finally {
      persistedDocument.destroy()
    }

    normalizePersistedSource(document, this.persistenceOrigin)
    await this.provider.storeUpdate(roomName, Y.encodeStateAsUpdate(document))

    const pendingWrites = new Set<Promise<number>>()
    this.pendingWrites.set(document, pendingWrites)
    document.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.persistenceOrigin) return
      const write = this.provider.storeUpdate(roomName, update)
      pendingWrites.add(write)
      void write
        .catch((error: unknown) => {
          console.error(`Could not persist local Yjs room ${roomName}:`, error)
        })
        .finally(() => pendingWrites.delete(write))
    })
  }
}

const databaseConfigured = () =>
  Boolean(process.env.DATABASE_URL || process.env.PGHOST)

export const databaseStatementTimeoutMs = 15_000
export const databaseQueryTimeoutMs = 20_000

export const createDatabasePool = () => {
  if (!databaseConfigured()) return null

  return new pg.Pool({
    ...(process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {}),
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: databaseStatementTimeoutMs,
    query_timeout: databaseQueryTimeoutMs,
    application_name: 'demystify',
  })
}

export const verifyDatabaseConnection = async (pool: Pool) => {
  await pool.query('SELECT 1')
}

export const createPostgresSessionStore = async (pool: Pool) => {
  const PostgresSessionStore = connectPgSimple(session)
  const store = new PostgresSessionStore({
    pool,
    tableName: 'demystify_sessions',
    createTableIfMissing: true,
  })
  await new Promise<void>((resolve, reject) => {
    store.get('demystify-session-schema-probe', (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return store
}

export class PostgresYjsPersistence implements ReadyYjsPersistence {
  readonly provider = this
  private readonly persistenceOrigin = Symbol('postgres-yjs-persistence')
  private readonly hydrations = new WeakMap<Yjs.Doc, Promise<void>>()

  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS demystify_yjs_updates (
        id BIGSERIAL PRIMARY KEY,
        room_name VARCHAR(100) NOT NULL,
        update_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS demystify_yjs_updates_room_id_idx
      ON demystify_yjs_updates (room_name, id)
    `)
  }

  bindState = (roomName: string, document: Yjs.Doc) => {
    const hydration = this.hydrate(roomName, document)
    this.hydrations.set(document, hydration)
    void hydration.catch((error: unknown) => {
      console.error(`Could not hydrate Yjs room ${roomName}:`, error)
    })
  }

  waitForHydration = async (document: Yjs.Doc) => {
    const hydration = this.hydrations.get(document)
    if (!hydration) {
      throw new Error('The Yjs document was not registered for PostgreSQL hydration.')
    }
    await hydration
  }

  writeState = async (roomName: string, document: Yjs.Doc) => {
    try {
      await this.waitForHydration(document)
    } catch {
      this.hydrations.delete(document)
      return
    }
    this.hydrations.delete(document)

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
        [roomName],
      )
      await client.query(
        `DELETE FROM demystify_yjs_updates WHERE room_name = $1`,
        [roomName],
      )
      await client.query(
        `
          INSERT INTO demystify_yjs_updates (room_name, update_data)
          VALUES ($1, $2)
        `,
        [roomName, Buffer.from(Y.encodeStateAsUpdate(document))],
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async hydrate(roomName: string, document: Yjs.Doc) {
    document.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this.persistenceOrigin) return
      void this.storeUpdate(roomName, update).catch((error: unknown) => {
        console.error(`Could not persist Yjs room ${roomName}:`, error)
      })
    })

    const result = await this.pool.query<{ update_data: Buffer }>(
      `
        SELECT update_data
        FROM demystify_yjs_updates
        WHERE room_name = $1
        ORDER BY id
      `,
      [roomName],
    )

    // Capture edits received while the database query was in flight.
    await this.storeUpdate(roomName, Y.encodeStateAsUpdate(document))
    for (const row of result.rows) {
      Y.applyUpdate(
        document,
        new Uint8Array(row.update_data),
        this.persistenceOrigin,
      )
    }
    if (normalizePersistedSource(document, this.persistenceOrigin)) {
      await this.storeUpdate(roomName, Y.encodeStateAsUpdate(document))
    }
  }

  private async storeUpdate(roomName: string, update: Uint8Array) {
    await this.pool.query(
      `
        INSERT INTO demystify_yjs_updates (room_name, update_data)
        VALUES ($1, $2)
      `,
      [roomName, Buffer.from(update)],
    )
  }
}