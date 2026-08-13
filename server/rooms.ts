import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Router, type Request } from 'express'
import type { Pool, PoolClient } from 'pg'
import { searchCrossrefWorks } from './citations.js'
import {
  ApiError,
  createRepositoryPullRequest,
  createRepositoryFilesSnapshot,
  createRepositorySnapshot,
  findRepositoryPullRequest,
  getRepositoryPullRequest,
  getRepositoryPullRequestCommentSync,
  requireRepositoryWriteAccess,
  upsertRepositoryPullRequestComment,
  upsertRepositoryPullRequestCommentReply,
  type RepositoryPullRequest,
  type RepositoryPullRequestCommentInput,
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

export interface RoomReview {
  number: number
  htmlUrl: string
  title: string
  state: 'draft' | 'open' | 'closed' | 'merged'
  createdAt: string
  updatedAt: string
}

export interface RoomShareCapability {
  id: string
  tokenHash: string
  createdAt: string
  expiresAt: string | null
}

export interface RoomRecord {
  roomName: string
  ownerId: number
  ownerLogin: string
  binding: RoomBinding | null
  review: RoomReview | null
  nextRoomName: string | null
  viewerShare: RoomShareCapability | null
  collaboratorShare: RoomShareCapability | null
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
  setReview(roomName: string, review: RoomReview): Promise<RoomRecord>
  ensureReview(
    roomName: string,
    createReview: () => Promise<RoomReview>,
  ): Promise<RoomRecord>
  createRevision(
    roomName: string,
    user: RoomUser,
    binding: RoomBinding,
  ): Promise<RoomRecord>
  setViewerShare(
    roomName: string,
    user: RoomUser,
    viewerShare: RoomShareCapability | null,
  ): Promise<RoomRecord>
  setCollaboratorShare(
    roomName: string,
    user: RoomUser,
    collaboratorShare: RoomShareCapability | null,
  ): Promise<RoomRecord>
}

export interface RoomLifecycleOptions {
  onReadOnlyChange?: (roomName: string, readOnly: boolean) => void
  hasPendingWorkingChanges?: (roomName: string) => Promise<boolean>
  decideLiveProposal?: (
    roomName: string,
    status: 'accepted' | 'rejected',
    actor: { id: string; name: string },
  ) => Promise<{ id: string; status: 'accepted' | 'rejected' } | null>
  markProposalCheckpointsSubmitted?: (
    roomName: string,
    commitSha: string,
  ) => Promise<void>
  getUnsubmittedProposalContributorNames?: (roomName: string) => Promise<string[]>
  onShareAccessRevoked?: (
    roomName: string,
    role: 'viewer' | 'collaborator',
  ) => void
}

export type RoomAccessRole = 'editor' | 'viewer' | 'collaborator'

export interface AuthorizedRoomAccess {
  room: RoomRecord
  role: RoomAccessRole
  actorId: string
  actorName: string
  ownedActorIds: string[]
  shareExpiresAt?: string | null
}

const roomPattern = /^[A-Za-z0-9_-]{8,100}$/
const repositoryPartPattern = /^[A-Za-z0-9_.-]+$/
const commentIdPattern = /^[A-Za-z0-9_-]{1,100}$/
const viewerTokenPattern = /^[A-Za-z0-9_-]{43}$/

export const validateRoomName = (roomName: string) => {
  if (!roomPattern.test(roomName)) {
    throw new ApiError(400, 'A valid document room is required.')
  }
  return roomName
}

const readRoomNameParameter = (request: Request) => {
  const value = request.params.roomName
  return validateRoomName(Array.isArray(value) ? value[0] : value)
}

const requireUser = (request: Request): RoomUser => {
  const user = request.session.github?.user
  if (!user) throw new ApiError(401, 'Connect GitHub to access this room.')
  return { id: user.id, login: user.login }
}

const saveSession = (request: Request) =>
  new Promise<void>((resolve, reject) => {
    request.session.save((error) => {
      if (error) reject(error)
      else resolve()
    })
  })

const hashViewerToken = (token: string) =>
  createHash('sha256').update(token).digest('hex')

const viewerTokenMatches = (token: string, expectedHash: string) => {
  const actual = Buffer.from(hashViewerToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const isShareActive = (share: RoomShareCapability | null) =>
  Boolean(
    share &&
    (!share.expiresAt || Date.parse(share.expiresAt) > Date.now()),
  )

const getShareGrant = (request: Request, room: RoomRecord) => {
  const grant = request.session.viewerRooms?.[room.roomName]
  const role = grant?.role ?? 'viewer'
  const share = role === 'collaborator'
    ? room.collaboratorShare
    : room.viewerShare
  if (
    !grant ||
    !isShareActive(share) ||
    grant.shareId !== share?.id ||
    (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.now())
  ) {
    return null
  }
  return {
    ...grant,
    role,
    actorId: grant.actorId ?? `share:${grant.shareId}`,
    actorName: grant.actorName ?? (role === 'collaborator' ? 'Guest contributor' : 'Guest viewer'),
  }
}

export const toClientRoom = ({ room, role, actorId, ownedActorIds }: AuthorizedRoomAccess) => {
  const { viewerShare, collaboratorShare, ...publicRoom } = room
  return {
    ...publicRoom,
    access: role,
    actorId,
    ownedActorIds,
    viewerLink: role === 'editor' && viewerShare
      ? {
          createdAt: viewerShare.createdAt,
          expiresAt: viewerShare.expiresAt,
        }
      : null,
    collaboratorLink: role === 'editor' && collaboratorShare
      ? {
          createdAt: collaboratorShare.createdAt,
          expiresAt: collaboratorShare.expiresAt,
        }
      : null,
  }
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

const readCommentText = (value: unknown, field: string, maxLength: number) => {
  const parsed = readText(value, field).trim()
  if (!parsed) throw new ApiError(400, `${field} is required.`)
  if (parsed.length > maxLength) {
    throw new ApiError(400, `${field} must be ${maxLength} characters or fewer.`)
  }
  return parsed
}

const readCommentSource = (value: unknown, field: string, maxLength: number) => {
  const parsed = readText(value, field)
  if (parsed.length > maxLength) {
    throw new ApiError(400, `${field} must be ${maxLength} characters or fewer.`)
  }
  return parsed
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

const getDocumentTitle = (content: string) =>
  content.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Untitled manuscript'

const getBibliographyPath = (manuscriptPath: string) => {
  const segments = manuscriptPath.split('/')
  segments[segments.length - 1] = 'references.bib'
  return segments.join('/')
}

const toRoomReview = (
  pullRequest: RepositoryPullRequest,
  existing?: RoomReview | null,
): RoomReview => {
  const now = new Date().toISOString()
  return {
    ...pullRequest,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

export const isTerminalReview = (review: RoomReview | null) =>
  review?.state === 'closed' || review?.state === 'merged'

export const requireWritableRoom = (room: RoomRecord) => {
  if (isTerminalReview(room.review)) {
    throw new ApiError(
      409,
      `This room is read-only because pull request #${room.review?.number} is ${room.review?.state}. Start the next revision to continue editing.`,
    )
  }
  return room
}

export class RoomStore implements RoomStoreLike {
  private readonly rooms = new Map<string, RoomRecord>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async initialize() {
    try {
      const records = JSON.parse(await readFile(this.filePath, 'utf8')) as RoomRecord[]
      for (const record of records) {
        if (roomPattern.test(record.roomName)) {
          this.rooms.set(record.roomName, {
            ...record,
            review: record.review ?? null,
            nextRoomName: record.nextRoomName ?? null,
            viewerShare: record.viewerShare ?? null,
            collaboratorShare: record.collaboratorShare ?? null,
          })
        }
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
        review: null,
        nextRoomName: null,
        viewerShare: null,
        collaboratorShare: null,
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

  setReview(roomName: string, review: RoomReview) {
    return this.withLock(async () => {
      const room = this.rooms.get(roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.review && room.review.number !== review.number) {
        throw new ApiError(409, 'This room is already associated with another pull request.')
      }

      const updated = {
        ...room,
        review,
        updatedAt: new Date().toISOString(),
      }
      this.rooms.set(roomName, updated)
      await this.persist()
      return updated
    })
  }

  ensureReview(roomName: string, createReview: () => Promise<RoomReview>) {
    return this.withLock(async () => {
      const room = this.rooms.get(roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.review) return room

      const review = await createReview()
      const updated = {
        ...room,
        review,
        updatedAt: new Date().toISOString(),
      }
      this.rooms.set(roomName, updated)
      await this.persist()
      return updated
    })
  }

  createRevision(roomName: string, user: RoomUser, binding: RoomBinding) {
    return this.withLock(async () => {
      const sourceRoom = this.rooms.get(roomName)
      if (!sourceRoom) throw new ApiError(404, 'This collaboration room does not exist.')
      if (sourceRoom.nextRoomName) {
        const existing = this.rooms.get(sourceRoom.nextRoomName)
        if (!existing) throw new ApiError(500, 'The next revision room is unavailable.')
        return existing
      }

      const nextRoomName = randomUUID()
      const now = new Date().toISOString()
      const nextRoom: RoomRecord = {
        roomName: nextRoomName,
        ownerId: user.id,
        ownerLogin: user.login,
        binding: {
          ...binding,
          branchName: `demystify/${nextRoomName.slice(0, 12)}`,
        },
        review: null,
        nextRoomName: null,
        viewerShare: null,
        collaboratorShare: null,
        createdAt: now,
        updatedAt: now,
      }
      this.rooms.set(nextRoomName, nextRoom)
      this.rooms.set(roomName, {
        ...sourceRoom,
        nextRoomName,
        updatedAt: now,
      })
      await this.persist()
      return nextRoom
    })
  }

  setViewerShare(
    roomName: string,
    user: RoomUser,
    viewerShare: RoomShareCapability | null,
  ) {
    return this.withLock(async () => {
      const room = this.rooms.get(roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can manage viewer links.')
      }
      const updated = {
        ...room,
        viewerShare,
        updatedAt: new Date().toISOString(),
      }
      this.rooms.set(roomName, updated)
      await this.persist()
      return updated
    })
  }

  setCollaboratorShare(
    roomName: string,
    user: RoomUser,
    collaboratorShare: RoomShareCapability | null,
  ) {
    return this.withLock(async () => {
      const room = this.rooms.get(roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can manage collaborator links.')
      }
      const updated = {
        ...room,
        collaboratorShare,
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
  review: RoomReview | null
  next_room_name: string | null
  viewer_share: RoomShareCapability | null
  collaborator_share: RoomShareCapability | null
  created_at: Date
  updated_at: Date
}

const rowToRoomRecord = (row: PostgresRoomRow): RoomRecord => ({
  roomName: row.room_name,
  ownerId: Number(row.owner_id),
  ownerLogin: row.owner_login,
  binding: row.binding,
  review: row.review ?? null,
  nextRoomName: row.next_room_name ?? null,
  viewerShare: row.viewer_share ?? null,
  collaboratorShare: row.collaborator_share ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
})

export class PostgresRoomStore implements RoomStoreLike {
  private readonly reviewCreations = new Map<string, Promise<RoomRecord>>()

  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS demystify_rooms (
        room_name VARCHAR(100) PRIMARY KEY,
        owner_id BIGINT NOT NULL,
        owner_login TEXT NOT NULL,
        binding JSONB,
        review JSONB,
        next_room_name VARCHAR(100),
        viewer_share JSONB,
        collaborator_share JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await this.pool.query(`
      ALTER TABLE demystify_rooms
      ADD COLUMN IF NOT EXISTS review JSONB
    `)
    await this.pool.query(`
      ALTER TABLE demystify_rooms
      ADD COLUMN IF NOT EXISTS next_room_name VARCHAR(100)
    `)
    await this.pool.query(`
      ALTER TABLE demystify_rooms
      ADD COLUMN IF NOT EXISTS viewer_share JSONB
    `)
    await this.pool.query(`
      ALTER TABLE demystify_rooms
      ADD COLUMN IF NOT EXISTS collaborator_share JSONB
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

  async setReview(roomName: string, review: RoomReview) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const room = await this.getForUpdate(client, roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.review && room.review.number !== review.number) {
        throw new ApiError(409, 'This room is already associated with another pull request.')
      }

      const result = await client.query<PostgresRoomRow>(
        `
          UPDATE demystify_rooms
          SET review = $2::jsonb, updated_at = NOW()
          WHERE room_name = $1
          RETURNING *
        `,
        [roomName, JSON.stringify(review)],
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

  ensureReview(
    roomName: string,
    createReview: () => Promise<RoomReview>,
  ) {
    const pending = this.reviewCreations.get(roomName)
    if (pending) return pending

    const creation = this.createReview(roomName, createReview).finally(() => {
      if (this.reviewCreations.get(roomName) === creation) {
        this.reviewCreations.delete(roomName)
      }
    })
    this.reviewCreations.set(roomName, creation)
    return creation
  }

  async createRevision(roomName: string, user: RoomUser, binding: RoomBinding) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const sourceRoom = await this.getForUpdate(client, roomName)
      if (!sourceRoom) throw new ApiError(404, 'This collaboration room does not exist.')
      if (sourceRoom.nextRoomName) {
        const existing = await client.query<PostgresRoomRow>(
          `SELECT * FROM demystify_rooms WHERE room_name = $1`,
          [sourceRoom.nextRoomName],
        )
        if (!existing.rows[0]) throw new ApiError(500, 'The next revision room is unavailable.')
        await client.query('COMMIT')
        return rowToRoomRecord(existing.rows[0])
      }

      const nextRoomName = randomUUID()
      const nextBinding: RoomBinding = {
        ...binding,
        branchName: `demystify/${nextRoomName.slice(0, 12)}`,
      }
      const created = await client.query<PostgresRoomRow>(
        `
          INSERT INTO demystify_rooms (
            room_name, owner_id, owner_login, binding
          ) VALUES ($1, $2, $3, $4::jsonb)
          RETURNING *
        `,
        [nextRoomName, user.id, user.login, JSON.stringify(nextBinding)],
      )
      await client.query(
        `
          UPDATE demystify_rooms
          SET next_room_name = $2, updated_at = NOW()
          WHERE room_name = $1
        `,
        [roomName, nextRoomName],
      )
      await client.query('COMMIT')
      return rowToRoomRecord(created.rows[0])
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async setViewerShare(
    roomName: string,
    user: RoomUser,
    viewerShare: RoomShareCapability | null,
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const room = await this.getForUpdate(client, roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can manage viewer links.')
      }
      const result = await client.query<PostgresRoomRow>(
        `
          UPDATE demystify_rooms
          SET viewer_share = $2::jsonb, updated_at = NOW()
          WHERE room_name = $1
          RETURNING *
        `,
        [roomName, viewerShare ? JSON.stringify(viewerShare) : null],
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

  async setCollaboratorShare(
    roomName: string,
    user: RoomUser,
    collaboratorShare: RoomShareCapability | null,
  ) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const room = await this.getForUpdate(client, roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.ownerId !== user.id) {
        throw new ApiError(403, 'Only the room owner can manage collaborator links.')
      }
      const result = await client.query<PostgresRoomRow>(
        `
          UPDATE demystify_rooms
          SET collaborator_share = $2::jsonb, updated_at = NOW()
          WHERE room_name = $1
          RETURNING *
        `,
        [roomName, collaboratorShare ? JSON.stringify(collaboratorShare) : null],
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

  private async createReview(
    roomName: string,
    createReview: () => Promise<RoomReview>,
  ) {
    const existing = await this.get(roomName)
    if (!existing) throw new ApiError(404, 'This collaboration room does not exist.')
    if (existing.review) return existing

    const review = await createReview()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const room = await this.getForUpdate(client, roomName)
      if (!room) throw new ApiError(404, 'This collaboration room does not exist.')
      if (room.review) {
        await client.query('COMMIT')
        return room
      }

      const result = await client.query<PostgresRoomRow>(
        `
          UPDATE demystify_rooms
          SET review = $2::jsonb, updated_at = NOW()
          WHERE room_name = $1
          RETURNING *
        `,
        [roomName, JSON.stringify(review)],
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

const authorizeEditorRoom = async (
  request: Request,
  roomStore: RoomStoreLike,
  room: RoomRecord,
  options: RoomLifecycleOptions = {},
) => {
  const user = requireUser(request)
  const roomName = room.roomName

  if (!room.binding) {
    if (room.ownerId !== user.id) {
      throw new ApiError(403, 'This unbound room is private to its owner.')
    }
    options.onReadOnlyChange?.(roomName, false)
    return room
  }

  await requireRepositoryWriteAccess(
    request,
    room.binding.owner,
    room.binding.repository,
  )
  if (!room.review) {
    options.onReadOnlyChange?.(roomName, false)
    return room
  }

  const currentReview = await getRepositoryPullRequest(
    request,
    requireBinding(room),
    room.review.number,
  )
  const reviewChanged =
    currentReview.htmlUrl !== room.review.htmlUrl ||
    currentReview.title !== room.review.title ||
    currentReview.state !== room.review.state
  const refreshedRoom = reviewChanged
    ? await roomStore.setReview(
        roomName,
        toRoomReview(currentReview, room.review),
      )
    : room
  options.onReadOnlyChange?.(roomName, isTerminalReview(refreshedRoom.review))
  return refreshedRoom
}

export const authorizeRoomAccess = async (
  request: Request,
  roomStore: RoomStoreLike,
  roomName: string,
  options: RoomLifecycleOptions = {},
): Promise<AuthorizedRoomAccess> => {
  const room = await roomStore.get(roomName)
  if (!room) throw new ApiError(404, 'This collaboration room has not been claimed.')
  const shareGrant = getShareGrant(request, room)

  if (shareGrant?.role === 'viewer') {
    options.onReadOnlyChange?.(roomName, isTerminalReview(room.review))
    return {
      room,
      role: 'viewer',
      actorId: request.session.github?.user
        ? `github:${request.session.github.user.id}`
        : shareGrant.actorId,
      actorName: request.session.github?.user
        ? request.session.github.user.name ?? `@${request.session.github.user.login}`
        : shareGrant.actorName,
      ownedActorIds: request.session.github?.user
        ? [`github:${request.session.github.user.id}`, shareGrant.actorId]
        : [shareGrant.actorId],
      shareExpiresAt: shareGrant.expiresAt,
    }
  }

  if (request.session.github?.user) {
    try {
      return {
        room: await authorizeEditorRoom(request, roomStore, room, options),
        role: 'editor',
        actorId: `github:${request.session.github.user.id}`,
        actorName: request.session.github.user.name ?? `@${request.session.github.user.login}`,
        ownedActorIds: [
          `github:${request.session.github.user.id}`,
          ...(shareGrant ? [shareGrant.actorId] : []),
        ],
      }
    } catch (error) {
      if (
        !shareGrant ||
        !(error instanceof ApiError) ||
        ![401, 403, 404].includes(error.status)
      ) {
        throw error
      }
    }
  }

  if (!shareGrant) {
    throw new ApiError(401, 'Connect GitHub or use an active sharing link.')
  }
  options.onReadOnlyChange?.(roomName, isTerminalReview(room.review))
  return {
    room,
    role: shareGrant.role,
    actorId: request.session.github?.user
      ? `github:${request.session.github.user.id}`
      : shareGrant.actorId,
    actorName: request.session.github?.user
      ? request.session.github.user.name ?? `@${request.session.github.user.login}`
      : shareGrant.actorName,
    ownedActorIds: request.session.github?.user
      ? [`github:${request.session.github.user.id}`, shareGrant.actorId]
      : [shareGrant.actorId],
    shareExpiresAt: shareGrant.expiresAt,
  }
}

export const authorizeRoomRequest = async (
  request: Request,
  roomStore: RoomStoreLike,
  roomName: string,
  options: RoomLifecycleOptions = {},
) => {
  const access = await authorizeRoomAccess(request, roomStore, roomName, options)
  if (access.role !== 'editor') {
    throw new ApiError(403, 'Maintainer access is required for this action.')
  }
  return access.room
}

export const createRoomRouter = (
  roomStore: RoomStoreLike,
  options: RoomLifecycleOptions = {},
) => {
  const router = Router()
  const commentMirrorQueues = new Map<string, Promise<void>>()

  const activateShareSession = async (
    request: Request,
    response: import('express').Response,
    role: 'viewer' | 'collaborator',
  ) => {
    const roomName = readRoomNameParameter(request)
    const token =
      request.get('X-Demystify-Share-Token') ??
      request.get('X-Demystify-Viewer-Token') ??
      ''
    if (!viewerTokenPattern.test(token)) {
      throw new ApiError(403, 'This sharing link is invalid or expired.')
    }
    const room = await roomStore.get(roomName)
    const share = role === 'viewer' ? room?.viewerShare : room?.collaboratorShare
    if (
      !room ||
      !isShareActive(share ?? null) ||
      !share ||
      !viewerTokenMatches(token, share.tokenHash)
    ) {
      throw new ApiError(403, 'This sharing link is invalid or expired.')
    }
    request.session.viewerRooms ??= {}
    const currentGrant = request.session.viewerRooms[roomName]
    const requestedActorName = typeof request.body?.actorName === 'string'
      ? request.body.actorName.trim().slice(0, 200)
      : ''
    request.session.viewerRooms[roomName] = {
      shareId: share.id,
      expiresAt: share.expiresAt,
      role,
      actorId: currentGrant?.shareId === share.id && currentGrant.actorId
        ? currentGrant.actorId
        : `share:${randomUUID()}`,
      actorName: requestedActorName || currentGrant?.actorName ||
        (role === 'collaborator' ? 'Guest contributor' : 'Guest viewer'),
    }
    await saveSession(request)
    response.status(204).end()
  }

  router.post('/rooms/:roomName/viewer-session', async (request, response) => {
    await activateShareSession(request, response, 'viewer')
  })

  router.post('/rooms/:roomName/collaborator-session', async (request, response) => {
    await activateShareSession(request, response, 'collaborator')
  })

  router.post('/rooms/:roomName/claim', async (request, response) => {
    const roomName = readRoomNameParameter(request)
    const existing = await roomStore.get(roomName)

    if (existing) {
      response.json(toClientRoom(
        await authorizeRoomAccess(request, roomStore, roomName, options),
      ))
      return
    }

    const user = requireUser(request)
    const claimed = await roomStore.claim(roomName, user)
    if (claimed.ownerId !== user.id) {
      await authorizeRoomRequest(request, roomStore, roomName, options)
    }
    options.onReadOnlyChange?.(roomName, false)
    response.status(201).json(toClientRoom({
      room: claimed,
      role: 'editor',
      actorId: `github:${user.id}`,
      actorName: request.session.github?.user?.name ?? `@${user.login}`,
      ownedActorIds: [`github:${user.id}`],
    }))
  })

  router.put('/rooms/:roomName/binding', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    await authorizeRoomRequest(request, roomStore, roomName, options)
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
    response.json(toClientRoom({
      room: await roomStore.setBinding(roomName, user, binding),
      role: 'editor',
      actorId: `github:${user.id}`,
      actorName: request.session.github?.user?.name ?? `@${user.login}`,
      ownedActorIds: [`github:${user.id}`],
    }))
  })

  const createShareLink = (role: 'viewer' | 'collaborator') =>
    async (request: Request, response: import('express').Response) => {
      const roomName = readRoomNameParameter(request)
      await authorizeRoomRequest(request, roomStore, roomName, options)
      const user = requireUser(request)
      const expiresInDays = request.body.expiresInDays
      if (
        expiresInDays !== null &&
        (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
      ) {
        throw new ApiError(400, 'expiresInDays must be null or an integer from 1 to 365.')
      }
      const token = randomBytes(32).toString('base64url')
      const now = new Date()
      const share: RoomShareCapability = {
        id: randomUUID(),
        tokenHash: hashViewerToken(token),
        createdAt: now.toISOString(),
        expiresAt: expiresInDays === null
          ? null
          : new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1_000).toISOString(),
      }
      const updated = role === 'viewer'
        ? await roomStore.setViewerShare(roomName, user, share)
        : await roomStore.setCollaboratorShare(roomName, user, share)
      options.onShareAccessRevoked?.(roomName, role)
      const clientRoom = toClientRoom({
        room: updated,
        role: 'editor',
        actorId: `github:${user.id}`,
        actorName: request.session.github?.user?.name ?? `@${user.login}`,
        ownedActorIds: [`github:${user.id}`],
      })
      const link = role === 'viewer' ? clientRoom.viewerLink : clientRoom.collaboratorLink
      response.status(201).json({
        token,
        link,
        ...(role === 'viewer' ? { viewerLink: link } : { collaboratorLink: link }),
      })
    }

  router.post('/rooms/:roomName/viewer-links', createShareLink('viewer'))
  router.post('/rooms/:roomName/collaborator-links', createShareLink('collaborator'))

  const revokeShareLink = (role: 'viewer' | 'collaborator') =>
    async (request: Request, response: import('express').Response) => {
      const roomName = readRoomNameParameter(request)
      await authorizeRoomRequest(request, roomStore, roomName, options)
      const user = requireUser(request)
      if (role === 'viewer') await roomStore.setViewerShare(roomName, user, null)
      else await roomStore.setCollaboratorShare(roomName, user, null)
      const grant = request.session.viewerRooms?.[roomName]
      if ((grant?.role ?? 'viewer') === role) delete request.session.viewerRooms?.[roomName]
      await saveSession(request)
      options.onShareAccessRevoked?.(roomName, role)
      response.status(204).end()
    }

  router.delete('/rooms/:roomName/viewer-links', revokeShareLink('viewer'))
  router.delete('/rooms/:roomName/collaborator-links', revokeShareLink('collaborator'))

  router.get('/rooms/:roomName/citations/search', async (request, response) => {
    const roomName = readRoomNameParameter(request)
    const access = await authorizeRoomAccess(request, roomStore, roomName, options)
    if (access.role === 'viewer') {
      throw new ApiError(403, 'Editing access is required to search for citations.')
    }
    requireWritableRoom(access.room)
    const query = typeof request.query.q === 'string' ? request.query.q : ''
    response.json({ results: await searchCrossrefWorks(query) })
  })

  router.post('/rooms/:roomName/proposal-decision', async (request, response) => {
    const roomName = readRoomNameParameter(request)
    requireWritableRoom(await authorizeRoomRequest(request, roomStore, roomName, options))
    const status = request.body.status
    if (status !== 'accepted' && status !== 'rejected') {
      throw new ApiError(400, 'status must be accepted or rejected.')
    }
    if (!options.decideLiveProposal) {
      throw new ApiError(503, 'Live proposal decisions are unavailable.')
    }
    const sessionUser = request.session.github?.user
    const user = requireUser(request)
    const checkpoint = await options.decideLiveProposal(roomName, status, {
      id: `github:${user.id}`,
      name: sessionUser?.name ?? `@${user.login}`,
    })
    if (!checkpoint) {
      throw new ApiError(409, 'The live proposal is already synchronized with accepted MyST.')
    }
    response.json(checkpoint)
  })

  router.post('/rooms/:roomName/snapshots', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = requireWritableRoom(
      await authorizeRoomRequest(request, roomStore, roomName, options),
    )
    if (await options.hasPendingWorkingChanges?.(roomName)) {
      throw new ApiError(
        409,
        'Accept or reject the live proposal before saving accepted MyST to GitHub.',
      )
    }
    const binding = requireBinding(room)
    const content = readText(request.body.content, 'content')
    const bibliography = request.body.bibliography == null
      ? undefined
      : typeof request.body.bibliography === 'string'
        ? {
            path: getBibliographyPath(binding.path),
            content: request.body.bibliography,
          }
        : {
            path: validatePath(request.body.bibliography.path),
            content: readText(request.body.bibliography.content, 'bibliography.content'),
          }
    if (bibliography && (!/\.bib$/i.test(bibliography.path) || bibliography.path === binding.path)) {
      throw new ApiError(400, 'bibliography.path must point to a distinct .bib file.')
    }
    const mystConfig = request.body.mystConfig == null
      ? undefined
      : {
          path: validatePath(request.body.mystConfig.path),
          content: readText(request.body.mystConfig.content, 'mystConfig.content'),
        }
    if (mystConfig && (!/\.ya?ml$/i.test(mystConfig.path) || mystConfig.path === binding.path)) {
      throw new ApiError(400, 'mystConfig.path must point to a distinct YAML file.')
    }
    if (mystConfig && bibliography && mystConfig.path === bibliography.path) {
      throw new ApiError(400, 'Bibliography and MyST config paths must be distinct.')
    }
    const projectFilePaths = new Set<string>()
    const projectFiles: Array<{ path: string; content: string }> = request.body.projectFiles == null
      ? []
      : Array.isArray(request.body.projectFiles) && request.body.projectFiles.length <= 50
        ? request.body.projectFiles.map((file: unknown) => {
            if (!file || typeof file !== 'object') {
              throw new ApiError(400, 'projectFiles must contain repository files.')
            }
            const record = file as Record<string, unknown>
            const path = validatePath(record.path)
            if (!/\.(?:md|myst|ya?ml)$/i.test(path)) {
              throw new ApiError(400, 'Project files must be MyST Markdown or YAML source files.')
            }
            if (
              path === binding.path ||
              path === bibliography?.path ||
              path === mystConfig?.path ||
              projectFilePaths.has(path)
            ) {
              throw new ApiError(400, `Project file path "${path}" is duplicated.`)
            }
            projectFilePaths.add(path)
            return { path, content: readText(record.content, `projectFiles.${path}`) }
          })
        : (() => {
            throw new ApiError(400, 'projectFiles must contain at most 50 files.')
          })()
    const requestedCommitMessage =
      typeof request.body.commitMessage === 'string'
        ? request.body.commitMessage
        : undefined
    const contributorNames = await options.getUnsubmittedProposalContributorNames?.(roomName)
    const commitMessage = contributorNames?.length
      ? `Update ${binding.path} after live review by ${contributorNames.join(', ')}`
      : requestedCommitMessage

    const filesByPath = new Map<string, string>([[binding.path, content]])
    if (bibliography !== undefined) {
      filesByPath.set(bibliography.path, bibliography.content)
    }
    if (mystConfig !== undefined) filesByPath.set(mystConfig.path, mystConfig.content)
    projectFiles.forEach((file) => filesByPath.set(file.path, file.content))
    const files = Array.from(filesByPath, ([path, fileContent]) => ({
      path,
      content: fileContent,
    }))
    const snapshot = files.length === 1
      ? await createRepositorySnapshot(request, binding, content, commitMessage)
      : await createRepositoryFilesSnapshot(request, binding, files, commitMessage)
    await options.markProposalCheckpointsSubmitted?.(roomName, snapshot.commitSha)
    let review = room.review
    if (!binding.isFork) {
      const existingPullRequest =
        !review && snapshot.unchanged
          ? await findRepositoryPullRequest(request, binding)
          : null
      if (!review && snapshot.unchanged && !existingPullRequest) {
        response.json({ ...snapshot, review: null })
        return
      }
      try {
        review = (await roomStore.ensureReview(roomName, async () => {
          const pullRequest = existingPullRequest ?? await createRepositoryPullRequest(
              request,
              binding,
              `Update ${getDocumentTitle(content)}`,
            )
          return toRoomReview(pullRequest)
        })).review
      } catch (error) {
        throw new ApiError(
          502,
          'The snapshot was committed, but its draft pull request could not be attached. Retry Save to GitHub.',
          { snapshot, cause: error instanceof Error ? error.message : String(error) },
        )
      }
    }

    response.json({ ...snapshot, review })
  })

  router.post('/rooms/:roomName/pull-requests', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = requireWritableRoom(
      await authorizeRoomRequest(request, roomStore, roomName, options),
    )
    const binding = requireBinding(room)
    const title = readBindingString(request.body.title, 'title').slice(0, 200)

    const updatedRoom = await roomStore.ensureReview(roomName, async () => {
      const pullRequest = await createRepositoryPullRequest(request, binding, title)
      return toRoomReview(pullRequest)
    })
    response.json(updatedRoom.review)
  })

  router.put('/rooms/:roomName/comments/:commentId', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const commentId = request.params.commentId
    if (!commentIdPattern.test(commentId)) {
      throw new ApiError(400, 'A valid comment ID is required.')
    }

    const room = requireWritableRoom(
      await authorizeRoomRequest(request, roomStore, roomName, options),
    )
    const binding = requireBinding(room)
    if (!room.review) {
      throw new ApiError(
        409,
        'Save a changed snapshot before mirroring comments to GitHub.',
      )
    }
    const reviewNumber = room.review.number

    const body = readCommentText(request.body.body, 'body', 60_000)
    const authorName = readCommentText(request.body.authorName, 'authorName', 100)
    if (typeof request.body.resolved !== 'boolean') {
      throw new ApiError(400, 'resolved must be a boolean.')
    }
    const githubCommentId = request.body.githubCommentId
    if (
      githubCommentId !== undefined &&
      (!Number.isSafeInteger(githubCommentId) || githubCommentId <= 0)
    ) {
      throw new ApiError(400, 'githubCommentId must be a positive integer.')
    }
    const githubMode = request.body.githubMode
    if (
      githubMode !== undefined &&
      githubMode !== 'conversation' &&
      githubMode !== 'review'
    ) {
      throw new ApiError(400, 'githubMode must be conversation or review.')
    }
    const rawAnchor = request.body.anchor
    let anchor: { startLine: number; endLine: number; quote: string } | undefined
    if (rawAnchor !== undefined) {
      if (
        !rawAnchor ||
        !Number.isSafeInteger(rawAnchor.startLine) ||
        !Number.isSafeInteger(rawAnchor.endLine) ||
        rawAnchor.startLine < 1 ||
        rawAnchor.endLine < rawAnchor.startLine ||
        rawAnchor.endLine > 1_000_000 ||
        rawAnchor.endLine - rawAnchor.startLine > 10_000
      ) {
        throw new ApiError(400, 'anchor must contain a valid line range.')
      }
      anchor = {
        startLine: rawAnchor.startLine,
        endLine: rawAnchor.endLine,
        quote: readCommentText(rawAnchor.quote, 'anchor.quote', 20_000),
      }
    }
    const rawSuggestion = request.body.suggestion
    let suggestion: RepositoryPullRequestCommentInput['suggestion']
    if (rawSuggestion !== undefined) {
      if (!rawSuggestion || typeof rawSuggestion !== 'object') {
        throw new ApiError(400, 'suggestion must describe a proposed edit.')
      }
      const kind = rawSuggestion.kind
      const status = rawSuggestion.status
      if (kind !== 'insert' && kind !== 'delete' && kind !== 'replace') {
        throw new ApiError(400, 'suggestion.kind must be insert, delete, or replace.')
      }
      if (
        status !== 'pending' &&
        status !== 'accepted' &&
        status !== 'rejected' &&
        status !== 'conflicted'
      ) {
        throw new ApiError(400, 'suggestion.status is invalid.')
      }
      const before = readCommentSource(rawSuggestion.before, 'suggestion.before', 60_000)
      const after = readCommentSource(rawSuggestion.after, 'suggestion.after', 60_000)
      if (
        (kind === 'insert' && (before || !after)) ||
        (kind === 'delete' && (!before || after)) ||
        (kind === 'replace' && (!before || !after))
      ) {
        throw new ApiError(400, 'suggestion text does not match its edit kind.')
      }
      const decidedByName = rawSuggestion.decidedByName === undefined
        ? undefined
        : readCommentText(rawSuggestion.decidedByName, 'suggestion.decidedByName', 100)
      const decidedAt = rawSuggestion.decidedAt === undefined
        ? undefined
        : readCommentText(rawSuggestion.decidedAt, 'suggestion.decidedAt', 100)
      const decided = status === 'accepted' || status === 'rejected'
      if (decided !== request.body.resolved) {
        throw new ApiError(400, 'resolved must match the suggestion decision status.')
      }
      if (decided && (!decidedByName || !decidedAt || Number.isNaN(Date.parse(decidedAt)))) {
        throw new ApiError(400, 'decided suggestions require a valid decision identity and time.')
      }
      suggestion = {
        kind,
        before,
        after,
        status,
        ...(decidedByName ? { decidedByName } : {}),
        ...(decidedAt ? { decidedAt } : {}),
      }
    }

    const mirrorKey = `${roomName}:${commentId}`
    const previousMirror = commentMirrorQueues.get(mirrorKey) ?? Promise.resolve()
    const mirror = previousMirror.then(() => upsertRepositoryPullRequestComment(
      request,
      binding,
      reviewNumber,
      {
        id: commentId,
        ...(githubCommentId ? { githubCommentId } : {}),
        ...(githubMode ? { githubMode } : {}),
        authorName,
        body,
        resolved: request.body.resolved,
        ...(suggestion ? { suggestion } : {}),
        ...(anchor ? { anchor } : {}),
      },
    ))
    const queueTail = mirror.then(() => undefined, () => undefined)
    commentMirrorQueues.set(mirrorKey, queueTail)
    void queueTail.finally(() => {
      if (commentMirrorQueues.get(mirrorKey) === queueTail) {
        commentMirrorQueues.delete(mirrorKey)
      }
    })
    response.json(await mirror)
  })

  router.put(
    '/rooms/:roomName/comments/:commentId/messages/:messageId',
    async (request, response) => {
      const roomName = validateRoomName(request.params.roomName)
      const commentId = request.params.commentId
      const messageId = request.params.messageId
      if (!commentIdPattern.test(commentId) || !commentIdPattern.test(messageId)) {
        throw new ApiError(400, 'Valid thread and message IDs are required.')
      }

      const room = requireWritableRoom(
        await authorizeRoomRequest(request, roomStore, roomName, options),
      )
      const binding = requireBinding(room)
      if (!room.review) {
        throw new ApiError(409, 'Save a changed snapshot before mirroring replies.')
      }
      const reviewNumber = room.review.number
      const rootGitHubCommentId = request.body.rootGitHubCommentId
      if (!Number.isSafeInteger(rootGitHubCommentId) || rootGitHubCommentId <= 0) {
        throw new ApiError(400, 'rootGitHubCommentId must be a positive integer.')
      }
      const githubCommentId = request.body.githubCommentId
      if (
        githubCommentId !== undefined &&
        (!Number.isSafeInteger(githubCommentId) || githubCommentId <= 0)
      ) {
        throw new ApiError(400, 'githubCommentId must be a positive integer.')
      }
      const mode = request.body.mode
      if (mode !== 'conversation' && mode !== 'review') {
        throw new ApiError(400, 'mode must be conversation or review.')
      }
      const body = readCommentText(request.body.body, 'body', 60_000)
      const authorName = readCommentText(request.body.authorName, 'authorName', 100)

      const mirrorKey = `${roomName}:${commentId}:${messageId}`
      const previousMirror = commentMirrorQueues.get(mirrorKey) ?? Promise.resolve()
      const mirror = previousMirror.then(() => upsertRepositoryPullRequestCommentReply(
        request,
        binding,
        reviewNumber,
        {
          id: messageId,
          threadId: commentId,
          ...(githubCommentId ? { githubCommentId } : {}),
          rootGitHubCommentId,
          mode,
          authorName,
          body,
        },
      ))
      const queueTail = mirror.then(() => undefined, () => undefined)
      commentMirrorQueues.set(mirrorKey, queueTail)
      void queueTail.finally(() => {
        if (commentMirrorQueues.get(mirrorKey) === queueTail) {
          commentMirrorQueues.delete(mirrorKey)
        }
      })
      response.json(await mirror)
    },
  )

  router.get('/rooms/:roomName/comments/sync', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = await authorizeRoomRequest(request, roomStore, roomName, options)
    const binding = requireBinding(room)
    if (!room.review) {
      response.json({ messages: [], resolutions: [] })
      return
    }
    response.json(await getRepositoryPullRequestCommentSync(
      request,
      binding,
      room.review.number,
    ))
  })

  router.post('/rooms/:roomName/revisions', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const room = await authorizeRoomRequest(request, roomStore, roomName, options)
    if (!isTerminalReview(room.review)) {
      throw new ApiError(
        409,
        'Start the next revision after this room pull request is closed or merged.',
      )
    }
    const user = requireUser(request)
    const binding = requireBinding(room)
    const boundRoom = await roomStore.createRevision(roomName, user, binding)
    options.onReadOnlyChange?.(boundRoom.roomName, false)
    response.status(201).json(toClientRoom({
      room: boundRoom,
      role: 'editor',
      actorId: `github:${user.id}`,
      actorName: request.session.github?.user?.name ?? `@${user.login}`,
      ownedActorIds: [`github:${user.id}`],
    }))
  })

  return router
}