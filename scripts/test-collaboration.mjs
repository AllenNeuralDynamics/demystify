import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const port = 9_000 + Math.floor(Math.random() * 500)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'demystify-collaboration-'))
const httpUrl = `http://127.0.0.1:${port}`
const serverUrl = `ws://127.0.0.1:${port}/collaboration`
const roomName = `integration-${Date.now()}`
const expectedText = `Shared at ${new Date().toISOString()}`
const expectedComment = {
  id: crypto.randomUUID(),
  author: 'Integration test',
  body: 'Shared comment',
}

const server = spawn(
  join(process.cwd(), 'node_modules', '.bin', 'tsx'),
  ['server/index.ts'],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ENABLE_TEST_AUTH: '1',
      HOST: '127.0.0.1',
      PORT: String(port),
      SESSION_SECRET: 'integration-test-session-secret',
      YPERSISTENCE: join(temporaryDirectory, 'yjs'),
      ROOMS_PATH: join(temporaryDirectory, 'rooms.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let serverOutput = ''
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString()
})
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString()
})

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${httpUrl}/api/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Server did not start.\n${serverOutput}`)
}

const waitForSync = (provider) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for sync')), 5_000)
    provider.once('sync', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

const waitForText = (sharedText, expected) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for "${expected}"`)),
      5_000,
    )
    const check = () => {
      if (sharedText.toString() !== expected) return
      clearTimeout(timeout)
      sharedText.unobserve(check)
      resolve()
    }

    sharedText.observe(check)
    check()
  })

const waitForComment = (comments, expectedId) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for comment')), 5_000)
    const check = () => {
      if (!comments.has(expectedId)) return
      clearTimeout(timeout)
      comments.unobserve(check)
      resolve()
    }

    comments.observe(check)
    check()
  })

const expectSocketRejection = (expectedStatus, cookie) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`${serverUrl}/${roomName}`, {
      ...(cookie ? { headers: { Cookie: cookie } } : {}),
    })
    socket.once('open', () => reject(new Error('Unauthorized WebSocket unexpectedly opened.')))
    socket.once('unexpected-response', (_request, response) => {
      try {
        assert.equal(response.statusCode, expectedStatus)
        response.resume()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
    socket.once('error', () => {
      // `unexpected-response` carries the status assertion.
    })
  })

const createTestSession = async (id, login) => {
  const response = await fetch(`${httpUrl}/api/test/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, login }),
  })
  assert.equal(response.status, 204)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie, 'Test session cookie was not issued.')
  return cookie
}

let firstProvider
let secondProvider
let firstDocument
let secondDocument

try {
  await waitForServer()

  const sessionCookie = await createTestSession(1, 'integration-test')

  const claimResponse = await fetch(`${httpUrl}/api/rooms/${roomName}/claim`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
  })
  assert.equal(claimResponse.status, 201)

  await expectSocketRejection(401)

  const otherUserCookie = await createTestSession(2, 'other-researcher')
  const otherUserClaim = await fetch(`${httpUrl}/api/rooms/${roomName}/claim`, {
    method: 'POST',
    headers: { Cookie: otherUserCookie },
  })
  assert.equal(otherUserClaim.status, 403)
  await expectSocketRejection(403, otherUserCookie)

  class AuthenticatedWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, protocols, { headers: { Cookie: sessionCookie } })
    }
  }

  firstDocument = new Y.Doc()
  secondDocument = new Y.Doc()
  firstProvider = new WebsocketProvider(serverUrl, roomName, firstDocument, {
    WebSocketPolyfill: AuthenticatedWebSocket,
  })
  secondProvider = new WebsocketProvider(serverUrl, roomName, secondDocument, {
    WebSocketPolyfill: AuthenticatedWebSocket,
  })

  await Promise.all([waitForSync(firstProvider), waitForSync(secondProvider)])
  const firstText = firstDocument.getText('content')
  const secondText = secondDocument.getText('content')
  const firstComments = firstDocument.getMap('comments')
  const secondComments = secondDocument.getMap('comments')
  const received = waitForText(secondText, expectedText)
  const receivedComment = waitForComment(secondComments, expectedComment.id)

  firstText.insert(0, expectedText)
  firstComments.set(expectedComment.id, expectedComment)
  await Promise.all([received, receivedComment])

  assert.equal(secondText.toString(), expectedText)
  assert.deepEqual(secondComments.get(expectedComment.id), expectedComment)
  console.log('Unauthorized users rejected; authorized clients converged.')
} finally {
  firstProvider?.destroy()
  secondProvider?.destroy()
  firstDocument?.destroy()
  secondDocument?.destroy()
  server.kill('SIGTERM')
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve()
    else server.once('exit', resolve)
  })
  await rm(temporaryDirectory, { recursive: true, force: true })
}
