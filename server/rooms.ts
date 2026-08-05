import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Router, type Request } from 'express'
import type { Pool, PoolClient } from 'pg'
import {
  ApiError,
  createRepositoryPullRequest,
  createRepositorySnapshot,
  requireRepositoryWriteAccess,
} from './github.js'

export interface RoomBinding {
  owner: string
  repository: string
  fullName: string
  isFork: boolean
  parentFullName: string | null
  path: string
  baseBranch: string
  branchName: string
}

export interface RoomRecord {
  roomName: string
  ownerId: number
  ownerLogin: string
  binding: RoomBinding | null
  createdAt: string
  updatedAt: string
}

interface RoomUser {
  id: number
  login: string
}

export interface RoomStoreLike {
  initialize(): Promise<void>
  get(roomName: string): Promise<RoomRecord | null>
  claim(roomName: string, user: RoomUser): Promise<RoomRecord>
  setBinding(
    roomName: string,
    user: RoomUser,
    binding: RoomBinding,
  ): Promise<RoomRecord>
}

const roomPattern = /^[A-Za-z0-9_-]{8,100}$/
const repositoryPartPattern = /^[A-Za-z0-9_.-]+$/

export const validateRoomName = (roomName: string) => {
  if (!roomPattern.test(roomName)) {
    throw new ApiError(400, 'A valid document room is required.')
  }
  return roomName
}

const requireUser = (request: Request): RoomUser => {
  const user = request.session.github?.user
  if (!user) throw new ApiError(401, 'Connect GitHub to access this room.')
  return { id: user.id, login: user.login }
}

const readBindingString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} is required.`)
  }
  return value.trim()
}

const validateRepositoryPart = (value: unknown, field: string) => {
  const parsed = readBindingString(value, field)
  if (!repositoryPartPattern.test(parsed)) {
    throw new ApiError(400, `${field} contains unsupported characters.`)
  }
  return parsed
}

const validatePath = (value: unknown) => {
  const parsed = readBindingString(value, 'path').replace(/^\/+/, '')
  if (!parsed || parsed.split('/').some((part) => part === '..')) {
    throw new ApiError(400, 'path must point to a repository file.')
  }
  return parsed
}

const readText = (value: unknown, field: string) => {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${field} must be text.`)
  }
  return value
}

const requireBinding = (room: RoomRecord) => {
  if (!room.binding) {
    throw new ApiError(409, 'Bind this room to a repository before publishing.')
  }
  return {
    ...room.binding,
    branchName: `demystify/${room.roomName.slice(0, 12)}`,
  }
}

export class RoomStore implements RoomStoreLike {
  private readonly rooms = new Map<string, RoomRecord>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async initialize() {
    try {
      const records = JSON.parse(await readFile(this.filePath, 'utf8')) as RoomRecord[]
      for (const record of records) {
        if (roomPattern.test(record.roomName)) this.rooms.set(record.roomName, record)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  async get(roomName: string) {
    return this.rooms.get(roomName) ?? null
  }

  claim(roomName: string, user: RoomUser) {
    return this.withLock(async () => {
      const existing = this.rooms.get(roomName)
      if (existing) return existing

      const now = new Date().toISOString()
      const room: RoomRecord = {
        roomName,
        ownerId: user.id,
        ownerLogin: user.login,
        binding: null,
        createdAt: now,
        updatedAt: now,
      }
      this.rooms.set(roomName, room)
      await this.persist()
      return room
    })
  }

  setBinding(roomName: string, user: RoomUser, binding: RoomBinding) {
    return this.withLock(async () => {
      const room = this.rooms.get(roomName)
      if (!room) throw new ApiError(404, 'Claim this room before binding a repository.')
      if (room.binding) {
        if (JSON.stringify(room.binding) === JSON.stringify(binding)) return room
        throw new ApiError(
          409,
          'This room is already bound to another repository file. Create a new room to change files.',
        )
      }
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can change its repository binding.')
      }

      const updated = {
        ...room,
        binding,
        updatedAt: new Date().toISOString(),
      }
      this.rooms.set(roomName, updated)
      await this.persist()
      return updated
    })
  }

  private withLock<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.queue.then(operation)
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async persist() {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    const records = Array.from(this.rooms.values()).sort((first, second) =>
      first.roomName.localeCompare(second.roomName),
    )
    await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, this.filePath)
  }
}

interface PostgresRoomRow {
  room_name: string
  owner_id: string
  owner_login: string
  binding: RoomBinding | null
  created_at: Date
  updated_at: Date
}

const rowToRoomRecord = (row: PostgresRoomRow): RoomRecord => ({
  roomName: row.room_name,
  ownerId: Number(row.owner_id),
  ownerLogin: row.owner_login,
  binding: row.binding,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

export class PostgresRoomStore implements RoomStoreLike {
  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS demystify_rooms (
        room_name VARCHAR(100) PRIMARY KEY,
        owner_id BIGINT NOT NULL,
        owner_login TEXT NOT NULL,
        binding JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  }

  async get(roomName: string) {
    const result = await this.pool.query<PostgresRoomRow>(
      `SELECT * FROM demystify_rooms WHERE room_name = $1`,
      [roomName],
    )
    return result.rows[0] ? rowToRoomRecord(result.rows[0]) : null
  }

  async claim(roomName: string, user: RoomUser) {
    await this.pool.query(
      `
        INSERT INTO demystify_rooms (room_name, owner_id, owner_login)
        VALUES ($1, $2, $3)
        ON CONFLICT (room_name) DO NOTHING
      `,
      [roomName, user.id, user.login],
    )
    const room = await this.get(roomName)
    if (!room) throw new ApiError(500, 'The room could not be claimed.')
    return room
  }

  async setBinding(roomName: string, user: RoomUser, binding: RoomBinding) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const room = await this.getForUpdate(client, roomName)
      if (!room) throw new ApiError(404, 'Claim this room before binding a repository.')
      if (room.binding) {
        if (JSON.stringify(room.binding) === JSON.stringify(binding)) {
          await client.query('COMMIT')
          return room
        }
        throw new ApiError(
          409,
          'This room is already bound to another repository file. Create a new room to change files.',
        )
      }
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can change its repository binding.')
      }

      const result = await client.query<PostgresRoomRow>(
        `
          UPDATE demystify_rooms
          SET binding = $2::jsonb, updated_at = NOW()
          WHERE room_name = $1
          RETURNING *
        `,
        [roomName, JSON.stringify(binding)],
      )
      await client.query('COMMIT')
      return rowToRoomRecord(result.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async getForUpdate(client: PoolClient, roomName: string) {
    const result = await client.query<PostgresRoomRow>(
      `SELECT * FROM demystify_rooms WHERE room_name = $1 FOR UPDATE`,
      [roomName],
    )
    return result.rows[0] ? rowToRoomRecord(result.rows[0]) : null
  }
}

export const authorizeRoomRequest = async (
  request: Request,
  roomStore: RoomStoreLike,
  roomName: string,
) => {
  const user = requireUser(request)
  const room = await roomStore.get(roomName)
  if (!room) throw new ApiError(404, 'This collaboration room has not been claimed.')

  if (!room.binding) {
    if (room.ownerId !== user.id) {
      throw new ApiError(403, 'This unbound room is private to its owner.')
    }
    return room
  }

  await requireRepositoryWriteAccess(
    request,
    room.binding.owner,
    room.binding.repository,
  )
  return room
}

export const createRoomRouter = (roomStore: RoomStoreLike) => {
  const router = Router()

  router.post('/rooms/:roomName/claim', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const user = requireUser(request)
    const existing = await roomStore.get(roomName)

    if (existing) {
      await authorizeRoomRequest(request, roomStore, roomName)
      response.json(existing)
      return
    }

    const claimed = await roomStore.claim(roomName, user)
    if (claimed.ownerId !== user.id) {
      await authorizeRoomRequest(request, roomStore, roomName)
    }
    response.status(201).json(claimed)
  })

  router.put('/rooms/:roomName/binding', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const user = requireUser(request)
    const owner = validateRepositoryPart(request.body.owner, 'owner')
    const repository = validateRepositoryPart(request.body.repository, 'repository')
    const path = validatePath(request.body.path)
    const branchName = `demystify/${roomName.slice(0, 12)}`
    const repositoryAccess = await requireRepositoryWriteAccess(
      request,
      owner,
      repository,
    )

    const binding: RoomBinding = {
      owner: repositoryAccess.owner.login,
      repository: repositoryAccess.name,
      fullName: repositoryAccess.full_name,
      isFork: repositoryAccess.fork,
      parentFullName: repositoryAccess.parent?.full_name ?? null,
      path,
      baseBranch: repositoryAccess.default_branch,
      branchName,
    }
    response.json(await roomStore.setBinding(roomName, user, binding))
  })

  router.post('/rooms/:roomName/snapshots', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = await authorizeRoomRequest(request, roomStore, roomName)
    const binding = requireBinding(room)
    const content = readText(request.body.content, 'content')
    const commitMessage =
      typeof request.body.commitMessage === 'string'
        ? request.body.commitMessage
        : undefined

    response.json(
      await createRepositorySnapshot(
        request,
        binding,
        content,
        commitMessage,
      ),
    )
  })

  router.post('/rooms/:roomName/pull-requests', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = await authorizeRoomRequest(request, roomStore, roomName)
    const binding = requireBinding(room)
    const title = readBindingString(request.body.title, 'title').slice(0, 200)

    response.json(
      await createRepositoryPullRequest(request, binding, title),
    )
  })

  return router
}