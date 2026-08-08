import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import type { Session, SessionData } from 'express-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createRoomRouter,
  RoomStore,
  type RoomBinding,
} from './rooms.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('room publication routes', () => {
  it('creates one draft PR on the first snapshot and reuses it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-router-'))
    temporaryDirectories.push(directory)
    const store = new RoomStore(join(directory, 'rooms.json'))
    await store.initialize()
    const roomName = 'snapshot-review-room'
    const user = { id: 42, login: 'researcher' }
    const binding: RoomBinding = {
      owner: 'researcher',
      repository: 'paper',
      fullName: 'researcher/paper',
      isFork: false,
      parentFullName: null,
      path: 'paper.md',
      baseBranch: 'main',
      branchName: 'demystify/snapshot-rev',
    }
    await store.claim(roomName, user)
    await store.setBinding(roomName, user, binding)

    let storedContent: string | null = null
    let pullRequestCreates = 0
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init)
      if (url.endsWith('/repos/researcher/paper')) {
        return jsonResponse({
          name: 'paper',
          full_name: 'researcher/paper',
          fork: false,
          default_branch: 'main',
          owner: { login: 'researcher' },
          permissions: { push: true },
        })
      }
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse({ object: { sha: 'branch-sha' } })
      }
      if (url.includes('/contents/paper.md') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string }
        storedContent = Buffer.from(body.content, 'base64').toString('utf8')
        return jsonResponse({
          commit: {
            sha: 'commit-sha',
            html_url: 'https://github.com/researcher/paper/commit/commit-sha',
          },
          content: { sha: 'file-sha' },
        })
      }
      if (url.includes('/contents/paper.md')) {
        return storedContent === null
          ? jsonResponse({ message: 'Not Found' }, 404)
          : jsonResponse({
              type: 'file',
              sha: 'file-sha',
              encoding: 'base64',
              content: Buffer.from(storedContent).toString('base64'),
            })
      }
      if (url.endsWith('/pulls') && init?.method === 'POST') {
        pullRequestCreates += 1
        const body = JSON.parse(String(init.body)) as { draft: boolean }
        expect(body.draft).toBe(true)
        return jsonResponse({
          number: 17,
          html_url: 'https://github.com/researcher/paper/pull/17',
          title: 'Update Test paper',
          state: 'open',
          draft: true,
        })
      }
      throw new Error(`Unexpected GitHub request: ${init?.method ?? 'GET'} ${url}`)
    })

    const app = express()
    app.use(express.json())
    app.use((request, _response, next) => {
      request.session = {
        github: {
          accessToken: 'test-token',
          user: { id: 42, login: 'researcher', name: 'Researcher', avatarUrl: '' },
        },
      } as Session & Partial<SessionData>
      next()
    })
    app.use('/api', createRoomRouter(store))
    const server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.')
    const endpoint = `http://127.0.0.1:${address.port}/api/rooms/${roomName}/snapshots`

    try {
      const [first, concurrent] = await Promise.all([
        originalFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '# Test paper\n' }),
        }),
        originalFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: '# Test paper\n' }),
        }),
      ])
      expect(first.status).toBe(200)
      expect(concurrent.status).toBe(200)
      const firstResult = await first.json() as {
        review: { number: number; state: string }
      }
      const concurrentResult = await concurrent.json() as {
        review: { number: number; state: string }
      }
      expect(firstResult.review).toMatchObject({ number: 17, state: 'draft' })
      expect(concurrentResult.review).toMatchObject({ number: 17, state: 'draft' })
      await expect(store.get(roomName)).resolves.toMatchObject({
        review: { number: 17, state: 'draft' },
      })

      const second = await originalFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Test paper\n' }),
      })
      expect(second.status).toBe(200)
      await expect(second.json()).resolves.toMatchObject({
        unchanged: true,
        review: { number: 17, state: 'draft' },
      })
      expect(pullRequestCreates).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      )
    }
  })
})