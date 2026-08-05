import { createRequire } from 'node:module'
import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import pg, { type Pool } from 'pg'
import type * as Yjs from 'yjs'

const require = createRequire(import.meta.url)
const Y = require('yjs') as typeof Yjs

const databaseConfigured = () =>
  Boolean(process.env.DATABASE_URL || process.env.PGHOST)

export const createDatabasePool = () => {
  if (!databaseConfigured()) return null

  return new pg.Pool({
    ...(process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {}),
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'demystify',
  })
}

export const verifyDatabaseConnection = async (pool: Pool) => {
  await pool.query('SELECT 1')
}

export const createPostgresSessionStore = (pool: Pool) => {
  const PostgresSessionStore = connectPgSimple(session)
  return new PostgresSessionStore({
    pool,
    tableName: 'demystify_sessions',
    createTableIfMissing: true,
  })
}

export class PostgresYjsPersistence {
  readonly provider = this
  private readonly persistenceOrigin = Symbol('postgres-yjs-persistence')
  private readonly hydrations = new WeakMap<Yjs.Doc, Promise<boolean>>()

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
    const hydration = this.hydrate(roomName, document).then(
      () => true,
      (error: unknown) => {
        console.error(`Could not hydrate Yjs room ${roomName}:`, error)
        return false
      },
    )
    this.hydrations.set(document, hydration)
  }

  writeState = async (roomName: string, document: Yjs.Doc) => {
    const hydrated = await this.hydrations.get(document)
    this.hydrations.delete(document)
    if (hydrated === false) return

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