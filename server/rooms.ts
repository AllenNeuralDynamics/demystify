import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Router, type Request } from 'express'
import { ApiError, requireRepositoryWriteAccess } from './github.js'

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

const roomPattern = /^[A-Za-z0-9_-]{8,100}$/
const repositoryPartPattern = /^[A-Za-z0-9_.-]+$/
const branchPattern = /^[A-Za-z0-9._/-]+$/

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

const validateBranch = (value: unknown, field: string) => {
  const parsed = readBindingString(value, field)
  if (
    !branchPattern.test(parsed) ||
    parsed.startsWith('/') ||
    parsed.endsWith('/') ||
    parsed.includes('..')
  ) {
    throw new ApiError(400, `${field} is not a valid Git branch name.`)
  }
  return parsed
}

export class RoomStore {
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

  get(roomName: string) {
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

export const authorizeRoomRequest = async (
  request: Request,
  roomStore: RoomStore,
  roomName: string,
) => {
  const user = requireUser(request)
  const room = roomStore.get(roomName)
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

export const createRoomRouter = (roomStore: RoomStore) => {
  const router = Router()

  router.post('/rooms/:roomName/claim', async (request, response) => {
    const roomName = validateRoomName(request.params.roomName)
    const user = requireUser(request)
    const existing = roomStore.get(roomName)

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
    const baseBranch = validateBranch(request.body.baseBranch, 'baseBranch')
    const branchName = validateBranch(request.body.branchName, 'branchName')
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
      baseBranch,
      branchName,
    }
    response.json(await roomStore.setBinding(roomName, user, binding))
  })

  return router
}