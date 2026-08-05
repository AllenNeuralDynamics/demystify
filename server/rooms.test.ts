import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RoomStore, type RoomBinding } from './rooms.js'

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
})