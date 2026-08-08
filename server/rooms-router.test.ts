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

const startRoomServer = async (store: RoomStore) => {
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
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  )

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

    const { server, baseUrl } = await startRoomServer(store)
    const endpoint = `${baseUrl}/api/rooms/${roomName}/snapshots`

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
      await closeServer(server)
    }
  })

  it('keeps an unchanged room without an existing PR as a successful no-op', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-router-'))
    temporaryDirectories.push(directory)
    const store = new RoomStore(join(directory, 'rooms.json'))
    await store.initialize()
    const roomName = 'unchanged-review-room'
    const content = '# Existing paper\n'
    await store.claim(roomName, { id: 42, login: 'researcher' })
    await store.setBinding(roomName, { id: 42, login: 'researcher' }, {
      owner: 'researcher',
      repository: 'paper',
      fullName: 'researcher/paper',
      isFork: false,
      parentFullName: null,
      path: 'paper.md',
      baseBranch: 'main',
      branchName: 'demystify/unchanged-r',
    })
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
      if (url.includes('/contents/paper.md')) {
        return jsonResponse({
          type: 'file',
          sha: 'file-sha',
          encoding: 'base64',
          content: Buffer.from(content).toString('base64'),
        })
      }
      if (url.includes('/pulls?state=all')) return jsonResponse([])
      if (url.endsWith('/pulls') && init?.method === 'POST') {
        pullRequestCreates += 1
      }
      throw new Error(`Unexpected GitHub request: ${init?.method ?? 'GET'} ${url}`)
    })
    const { server, baseUrl } = await startRoomServer(store)

    try {
      const response = await originalFetch(
        `${baseUrl}/api/rooms/${roomName}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      )

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        unchanged: true,
        review: null,
      })
      expect(pullRequestCreates).toBe(0)
      await expect(store.get(roomName)).resolves.toMatchObject({ review: null })
    } finally {
      await closeServer(server)
    }
  })

  it('mirrors a comment to the pull request persisted for the room', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'demystify-room-router-'))
    temporaryDirectories.push(directory)
    const store = new RoomStore(join(directory, 'rooms.json'))
    await store.initialize()
    const roomName = 'comment-review-room'
    const user = { id: 42, login: 'researcher' }
    await store.claim(roomName, user)
    await store.setBinding(roomName, user, {
      owner: 'researcher',
      repository: 'paper',
      fullName: 'researcher/paper',
      isFork: false,
      parentFullName: null,
      path: 'paper.md',
      baseBranch: 'main',
      branchName: 'demystify/comment-rev',
    })
    await store.setReview(roomName, {
      number: 17,
      htmlUrl: 'https://github.com/researcher/paper/pull/17',
      title: 'Update paper',
      state: 'draft',
      createdAt: '2026-08-08T05:00:00Z',
      updatedAt: '2026-08-08T05:00:00Z',
    })

    const originalFetch = globalThis.fetch
    const githubRequests: string[] = []
    let mirroredBody: string | null = null
    let commentCreates = 0
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init)
      githubRequests.push(`${init?.method ?? 'GET'} ${url}`)
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
      if (url.includes('/issues/17/comments?')) {
        return jsonResponse(mirroredBody ? [{
          id: 101,
          html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
          body: mirroredBody,
          updated_at: '2026-08-08T05:01:00Z',
        }] : [])
      }
      if (url.endsWith('/issues/17/comments') && init?.method === 'POST') {
        const requestBody = JSON.parse(String(init.body)) as { body: string }
        expect(requestBody.body).toContain('<!-- demystify-comment:comment-1 -->')
        mirroredBody = requestBody.body
        commentCreates += 1
        return jsonResponse({
          id: 101,
          html_url: 'https://github.com/researcher/paper/pull/17#issuecomment-101',
          body: requestBody.body,
          updated_at: '2026-08-08T05:01:00Z',
        })
      }
      throw new Error(`Unexpected GitHub request: ${init?.method ?? 'GET'} ${url}`)
    })

    const { server, baseUrl } = await startRoomServer(store)
    try {
      const endpoint = `${baseUrl}/api/rooms/${roomName}/comments/comment-1`
      const init = {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: 'Review this section',
          authorName: 'Researcher',
          resolved: false,
          pullRequestNumber: 999,
        }),
      }
      const responses = await Promise.all([
        originalFetch(endpoint, init),
        originalFetch(endpoint, init),
      ])

      expect(responses.map((response) => response.status)).toEqual([200, 200])
      await expect(Promise.all(responses.map((response) => response.json())))
        .resolves.toEqual([expect.objectContaining({ id: 101 }), expect.objectContaining({ id: 101 })])
      expect(githubRequests).toContain(
        'POST https://api.github.com/repos/researcher/paper/issues/17/comments',
      )
      expect(githubRequests.join('\n')).not.toContain('/issues/999/')
      expect(commentCreates).toBe(1)
    } finally {
      await closeServer(server)
    }
  })
})