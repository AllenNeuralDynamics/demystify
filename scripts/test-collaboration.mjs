import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const port = 9_000 + Math.floor(Math.random() * 500)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'demystify-collaboration-'))
const httpUrl = `http://127.0.0.1:${port}`
const serverUrl = `ws://127.0.0.1:${port}/collaboration`
const roomName = `integration-${Date.now()}`
const expectedText = `Shared at ${new Date().toISOString()}`
const expectedCommentId = crypto.randomUUID()
const expectedReply = {
  id: crypto.randomUUID(),
  threadId: expectedCommentId,
  authorId: 'github:1',
  authorName: 'Integration test',
  authorColor: '#16705d',
  body: 'Shared reply',
  createdAt: new Date().toISOString(),
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
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for sync.\n${serverOutput}`)),
      5_000,
    )
    provider.once('sync', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

const waitForStatus = (provider, expectedStatus) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for provider status ${expectedStatus}`)),
      5_000,
    )
    const check = ({ status }) => {
      if (status !== expectedStatus) return
      clearTimeout(timeout)
      provider.off('status', check)
      resolve()
    }
    provider.on('status', check)
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

const verifyPostgresPersistence = async () => {
  if (!process.env.DATABASE_URL) return

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM demystify_sessions) AS sessions,
          (SELECT COUNT(*)::int FROM demystify_rooms) AS rooms,
          (SELECT COUNT(*)::int FROM demystify_yjs_updates) AS yjs_updates
      `)
      const counts = result.rows[0]
      if (counts.sessions > 0 && counts.rooms > 0 && counts.yjs_updates > 0) {
        console.log(
          `PostgreSQL persisted sessions=${counts.sessions}, rooms=${counts.rooms}, yjs_updates=${counts.yjs_updates}.`,
        )
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('PostgreSQL did not persist all collaboration state.')
  } finally {
    await pool.end()
  }
}

let firstProvider
let secondProvider
let viewerProvider
let archivedProvider
let firstDocument
let secondDocument
let viewerDocument
let archivedDocument

try {
  await waitForServer()

  const sessionCookie = await createTestSession(1, 'integration-test')

  const claimResponse = await fetch(`${httpUrl}/api/rooms/${roomName}/claim`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
  })
  assert.equal(claimResponse.status, 201)

  const viewerLinkResponse = await fetch(
    `${httpUrl}/api/rooms/${roomName}/viewer-links`,
    {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresInDays: 7 }),
    },
  )
  assert.equal(viewerLinkResponse.status, 201)
  const viewerLink = await viewerLinkResponse.json()
  assert.match(viewerLink.token, /^[A-Za-z0-9_-]{43}$/)
  const viewerSessionResponse = await fetch(
    `${httpUrl}/api/rooms/${roomName}/viewer-session`,
    {
      method: 'POST',
      headers: { 'X-Demystify-Viewer-Token': viewerLink.token },
    },
  )
  assert.equal(viewerSessionResponse.status, 204)
  const viewerCookie = viewerSessionResponse.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(viewerCookie, 'Viewer session cookie was not issued.')
  const viewerClaim = await fetch(`${httpUrl}/api/rooms/${roomName}/claim`, {
    method: 'POST',
    headers: { Cookie: viewerCookie },
  })
  assert.equal(viewerClaim.status, 200)
  assert.equal((await viewerClaim.json()).access, 'viewer')
  const viewerSnapshot = await fetch(`${httpUrl}/api/rooms/${roomName}/snapshots`, {
    method: 'POST',
    headers: {
      Cookie: viewerCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: '# Viewer write must fail' }),
  })
  assert.equal(viewerSnapshot.status, 403)

  const unboundSnapshotResponse = await fetch(
    `${httpUrl}/api/rooms/${roomName}/snapshots`,
    {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: '# Unauthorized target test' }),
    },
  )
  assert.equal(unboundSnapshotResponse.status, 409)

  const unboundPullRequestResponse = await fetch(
    `${httpUrl}/api/rooms/${roomName}/pull-requests`,
    {
      method: 'POST',
      headers: {
        Cookie: sessionCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Unauthorized target test' }),
    },
  )
  assert.equal(unboundPullRequestResponse.status, 409)

  const unscopedSnapshotResponse = await fetch(`${httpUrl}/api/github/snapshots`, {
    method: 'POST',
    headers: {
      Cookie: sessionCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: '# Unscoped write test' }),
  })
  assert.equal(unscopedSnapshotResponse.status, 404)

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

  class ViewerWebSocket extends WebSocket {
    constructor(address, protocols) {
      super(address, protocols, { headers: { Cookie: viewerCookie } })
    }
  }

  firstDocument = new Y.Doc()
  secondDocument = new Y.Doc()
  firstProvider = new WebsocketProvider(serverUrl, roomName, firstDocument, {
    WebSocketPolyfill: AuthenticatedWebSocket,
    disableBc: true,
  })
  secondProvider = new WebsocketProvider(serverUrl, roomName, secondDocument, {
    WebSocketPolyfill: AuthenticatedWebSocket,
    disableBc: true,
  })

  await Promise.all([waitForSync(firstProvider), waitForSync(secondProvider)])
  const firstText = firstDocument.getText('content')
  const secondText = secondDocument.getText('content')
  const firstComments = firstDocument.getMap('comments')
  const secondComments = secondDocument.getMap('comments')
  const firstCommentMessages = firstDocument.getMap('commentMessages')
  const secondCommentMessages = secondDocument.getMap('commentMessages')
  const received = waitForText(secondText, expectedText)
  const receivedComment = waitForComment(secondComments, expectedCommentId)
  const receivedReply = waitForComment(secondCommentMessages, expectedReply.id)

  firstText.insert(0, expectedText)
  const expectedComment = {
    id: expectedCommentId,
    authorId: 'github:1',
    authorName: 'Integration test',
    authorColor: '#16705d',
    body: 'Shared comment',
    createdAt: new Date().toISOString(),
    resolved: false,
    anchor: {
      version: 1,
      start: Buffer.from(Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(firstText, 0, 0),
      )).toString('base64'),
      end: Buffer.from(Y.encodeRelativePosition(
        Y.createRelativePositionFromTypeIndex(firstText, firstText.length, -1),
      )).toString('base64'),
      quote: expectedText,
    },
  }
  firstComments.set(expectedComment.id, expectedComment)
  firstCommentMessages.set(expectedReply.id, expectedReply)
  await Promise.all([received, receivedComment, receivedReply])

  assert.equal(secondText.toString(), expectedText)
  assert.deepEqual(secondComments.get(expectedComment.id), expectedComment)
  assert.deepEqual(secondCommentMessages.get(expectedReply.id), expectedReply)
  const receivedAnchor = secondComments.get(expectedComment.id).anchor
  const receivedStart = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(Buffer.from(receivedAnchor.start, 'base64')),
    secondDocument,
  )
  const receivedEnd = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(Buffer.from(receivedAnchor.end, 'base64')),
    secondDocument,
  )
  assert.equal(secondText.toString().slice(receivedStart.index, receivedEnd.index), expectedText)

  viewerDocument = new Y.Doc()
  viewerProvider = new WebsocketProvider(serverUrl, roomName, viewerDocument, {
    WebSocketPolyfill: ViewerWebSocket,
    disableBc: true,
  })
  await waitForSync(viewerProvider)
  let viewerText = viewerDocument.getText('content')
  await waitForText(viewerText, expectedText)
  viewerText.insert(viewerText.length, ' viewer-blocked')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(secondText.toString(), expectedText)

  viewerProvider.destroy()
  viewerDocument.destroy()
  viewerDocument = new Y.Doc()
  viewerProvider = new WebsocketProvider(serverUrl, roomName, viewerDocument, {
    WebSocketPolyfill: ViewerWebSocket,
    disableBc: true,
  })
  await waitForSync(viewerProvider)
  viewerText = viewerDocument.getText('content')
  await waitForText(viewerText, expectedText)
  const editorExpectedText = `${expectedText} editor-accepted`
  const editorReceived = waitForText(secondText, editorExpectedText)
  const viewerReceived = waitForText(viewerText, editorExpectedText)
  firstText.insert(firstText.length, ' editor-accepted')
  await Promise.all([editorReceived, viewerReceived])

  const viewerDisconnected = waitForStatus(viewerProvider, 'disconnected')
  const revokeViewer = await fetch(`${httpUrl}/api/rooms/${roomName}/viewer-links`, {
    method: 'DELETE',
    headers: { Cookie: sessionCookie },
  })
  assert.equal(revokeViewer.status, 204)
  await viewerDisconnected

  const readOnlyResponse = await fetch(
    `${httpUrl}/api/test/rooms/${roomName}/read-only`,
    { method: 'POST', headers: { Cookie: sessionCookie } },
  )
  assert.equal(readOnlyResponse.status, 204)

  firstText.insert(firstText.length, ' blocked')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(secondText.toString(), editorExpectedText)

  archivedDocument = new Y.Doc()
  archivedProvider = new WebsocketProvider(serverUrl, roomName, archivedDocument, {
    WebSocketPolyfill: AuthenticatedWebSocket,
    disableBc: true,
  })
  await waitForSync(archivedProvider)
  const archivedText = archivedDocument.getText('content')
  await waitForText(archivedText, editorExpectedText)
  archivedText.insert(archivedText.length, ' rejected')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(secondText.toString(), editorExpectedText)
  await verifyPostgresPersistence()
  console.log('Unauthorized users rejected; editors and viewers converged; read-only writes blocked.')
} finally {
  firstProvider?.destroy()
  secondProvider?.destroy()
  viewerProvider?.destroy()
  archivedProvider?.destroy()
  firstDocument?.destroy()
  secondDocument?.destroy()
  viewerDocument?.destroy()
  archivedDocument?.destroy()
  server.kill('SIGTERM')
  await new Promise((resolve) => {
    if (server.exitCode !== null) resolve()
    else server.once('exit', resolve)
  })
  await rm(temporaryDirectory, { recursive: true, force: true })
}
