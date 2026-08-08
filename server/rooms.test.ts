import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PostgresRoomStore,
  RoomStore,
  type RoomBinding,
  type RoomReview,
} from './rooms.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('RoomStore', () => {
  it('persists room ownership and repository bindings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'rooms.json')
    const store = new RoomStore(filePath)
    await store.initialize()

    const user = { id: 42, login: 'researcher' }
    const binding: RoomBinding = {
      owner: 'researcher',
      repository: 'paper',
      fullName: 'researcher/paper',
      isFork: false,
      parentFullName: null,
      path: 'index.md',
      baseBranch: 'main',
      branchName: 'demystify/test-room',
    }

    await store.claim('test-room-123', user)
    await store.setBinding('test-room-123', user, binding)

    const restored = new RoomStore(filePath)
    await restored.initialize()
    await expect(restored.get('test-room-123')).resolves.toMatchObject({
      ownerId: 42,
      ownerLogin: 'researcher',
      binding,
    })
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toHaveLength(1)
  })

  it('allows identical binding retries but rejects rebinding a room', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const store = new RoomStore(join(directory, 'rooms.json'))
    await store.initialize()
    const user = { id: 42, login: 'researcher' }
    const binding: RoomBinding = {
      owner: 'researcher',
      repository: 'paper',
      fullName: 'researcher/paper',
      isFork: false,
      parentFullName: null,
      path: 'index.md',
      baseBranch: 'main',
      branchName: 'demystify/test-room',
    }

    await store.claim('test-room-456', user)
    const firstBinding = await store.setBinding('test-room-456', user, binding)
    await expect(store.setBinding('test-room-456', user, binding)).resolves.toEqual(
      firstBinding,
    )
    await expect(
      store.setBinding('test-room-456', user, { ...binding, path: 'other.md' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('persists one pull-request review per room', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'rooms.json')
    const store = new RoomStore(filePath)
    await store.initialize()
    const review: RoomReview = {
      number: 17,
      htmlUrl: 'https://github.com/researcher/paper/pull/17',
      title: 'Update manuscript',
      state: 'draft',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    }

    await store.claim('test-room-review', { id: 42, login: 'researcher' })
    await store.setReview('test-room-review', review)

    const restored = new RoomStore(filePath)
    await restored.initialize()
    await expect(restored.get('test-room-review')).resolves.toMatchObject({
      review,
    })
    await expect(
      store.setReview('test-room-review', { ...review, number: 18 }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('persists sharing capability metadata and restricts management to the owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'rooms.json')
    const store = new RoomStore(filePath)
    await store.initialize()
    const owner = { id: 42, login: 'researcher' }
    const viewerShare = {
      id: 'share-1',
      tokenHash: 'a'.repeat(64),
      createdAt: '2026-08-08T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
    }
    const collaboratorShare = {
      ...viewerShare,
      id: 'share-2',
      tokenHash: 'b'.repeat(64),
    }

    await store.claim('viewer-store-room', owner)
    await store.setViewerShare('viewer-store-room', owner, viewerShare)
    await store.setCollaboratorShare(
      'viewer-store-room',
      owner,
      collaboratorShare,
    )
    await expect(
      store.setViewerShare(
        'viewer-store-room',
        { id: 84, login: 'other' },
        null,
      ),
    ).rejects.toMatchObject({ status: 403 })

    const restored = new RoomStore(filePath)
    await restored.initialize()
    await expect(restored.get('viewer-store-room')).resolves.toMatchObject({
      viewerShare,
      collaboratorShare,
    })
  })

  it('serializes concurrent first-review creation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const store = new RoomStore(join(directory, 'rooms.json'))
    await store.initialize()
    await store.claim('concurrent-review-room', { id: 42, login: 'researcher' })
    let createCalls = 0
    const createReview = async (): Promise<RoomReview> => {
      createCalls += 1
      await Promise.resolve()
      return {
        number: 17,
        htmlUrl: 'https://github.com/researcher/paper/pull/17',
        title: 'Update manuscript',
        state: 'draft',
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
      }
    }

    const [first, second] = await Promise.all([
      store.ensureReview('concurrent-review-room', createReview),
      store.ensureReview('concurrent-review-room', createReview),
    ])

    expect(createCalls).toBe(1)
    expect(first.review).toEqual(second.review)
  })

  it('loads legacy room records without review state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-store-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'rooms.json')
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        filePath,
        JSON.stringify([
          {
            roomName: 'legacy-room-123',
            ownerId: 42,
            ownerLogin: 'researcher',
            binding: null,
            createdAt: '2026-08-08T00:00:00.000Z',
            updatedAt: '2026-08-08T00:00:00.000Z',
          },
        ]),
      ),
    )
    const store = new RoomStore(filePath)

    await store.initialize()

    await expect(store.get('legacy-room-123')).resolves.toMatchObject({
      review: null,
    })
  })

  it('coalesces PostgreSQL review creation without holding a transaction during I/O', async () => {
    const now = new Date('2026-08-08T00:00:00.000Z')
    const row = {
      room_name: 'postgres-review-room',
      owner_id: '42',
      owner_login: 'researcher',
      binding: null,
      review: null,
      created_at: now,
      updated_at: now,
    }
    const review: RoomReview = {
      number: 17,
      htmlUrl: 'https://github.com/researcher/paper/pull/17',
      title: 'Update manuscript',
      state: 'draft',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const client = {
      query: vi.fn((statement: string) => {
        if (statement.includes('SELECT *')) return Promise.resolve({ rows: [row] })
        if (statement.includes('UPDATE')) {
          return Promise.resolve({ rows: [{ ...row, review }] })
        }
        return Promise.resolve({ rows: [] })
      }),
      release: vi.fn(),
    }
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [row] }),
      connect: vi.fn().mockResolvedValue(client),
    }
    const store = new PostgresRoomStore(pool as never)
    let createCalls = 0
    let transactionStartedDuringCreation = false
    const createReview = async () => {
      createCalls += 1
      transactionStartedDuringCreation = client.query.mock.calls.length > 0
      await Promise.resolve()
      return review
    }

    const [first, second] = await Promise.all([
      store.ensureReview('postgres-review-room', createReview),
      store.ensureReview('postgres-review-room', createReview),
    ])

    expect(createCalls).toBe(1)
    expect(transactionStartedDuringCreation).toBe(false)
    expect(first.review).toEqual(review)
    expect(second.review).toEqual(review)
    expect(pool.connect).toHaveBeenCalledOnce()
  })
})