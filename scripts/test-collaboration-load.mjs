import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

process.setMaxListeners(0)

const editorCount = 5
const viewerCount = 95
const participantCount = editorCount + viewerCount
const documentSize = 100_000
const port = 9_300 + Math.floor(Math.random() * 400)
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'demystify-load-'))
const httpUrl = `http://127.0.0.1:${port}`
const serverUrl = `ws://127.0.0.1:${port}/collaboration`
const roomName = `load-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
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
      SESSION_SECRET: 'load-test-session-secret',
      YPERSISTENCE: join(temporaryDirectory, 'yjs'),
      ROOMS_PATH: join(temporaryDirectory, 'rooms.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let serverOutput = ''
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString() })
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString() })

const waitUntil = async (predicate, timeoutMs, label) => {
  const startedAt = performance.now()
  while (!(await predicate())) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}.\n${serverOutput}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return performance.now() - startedAt
}

const waitForServer = () => waitUntil(async () => {
  try {
    return (await fetch(`${httpUrl}/api/health`)).ok
  } catch {
    return false
  }
}, 15_000, 'server startup')

const waitForSync = (provider) => new Promise((resolve, reject) => {
  const startedAt = performance.now()
  const timeout = setTimeout(
    () => reject(new Error(`Timed out waiting for Yjs sync.\n${serverOutput}`)),
    15_000,
  )
  provider.once('sync', (synced) => {
    if (!synced) return
    clearTimeout(timeout)
    resolve(performance.now() - startedAt)
  })
})

const round = (value) => Math.round(value * 10) / 10
const percentile = (values, fraction) => {
  const ordered = [...values].sort((first, second) => first - second)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]
}

const createCookie = async (path, options = {}) => {
  const response = await fetch(`${httpUrl}${path}`, options)
  assert.equal(response.status, options.expectedStatus ?? 204)
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie, `No session cookie was returned from ${path}.`)
  return cookie
}

const createSocketClass = (cookie) => class AuthenticatedWebSocket extends WebSocket {
  constructor(address, protocols) {
    super(address, protocols, { headers: { Cookie: cookie } })
  }
}

const openClient = async (index, role, WebSocketPolyfill) => {
  const document = new Y.Doc()
  const provider = new WebsocketProvider(serverUrl, roomName, document, {
    WebSocketPolyfill,
    disableBc: true,
    connect: false,
  })
  provider.awareness.setLocalStateField('user', {
    id: `${role}:${index}`,
    name: `${role === 'editor' ? 'Editor' : 'Viewer'} ${index}`,
    color: role === 'editor' ? '#16705d' : '#27628d',
    colorLight: role === 'editor' ? '#dcefe9' : '#e3eef7',
  })
  const synced = waitForSync(provider)
  provider.connect()
  return { document, provider, role, syncMs: await synced }
}

const closeClient = ({ document, provider }) => {
  provider.destroy()
  document.destroy()
}

const stopServer = async () => {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await new Promise((resolve) => server.once('exit', resolve))
}

const clients = []
try {
  await waitForServer()
  const editorCookie = await createCookie('/api/test/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 1, login: 'load-editor' }),
  })
  const claim = await fetch(`${httpUrl}/api/rooms/${roomName}/claim`, {
    method: 'POST',
    headers: { Cookie: editorCookie },
  })
  assert.equal(claim.status, 201)
  const viewerLinkResponse = await fetch(`${httpUrl}/api/rooms/${roomName}/viewer-links`, {
    method: 'POST',
    headers: { Cookie: editorCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresInDays: 7 }),
  })
  assert.equal(viewerLinkResponse.status, 201)
  const { token } = await viewerLinkResponse.json()
  const viewerCookie = await createCookie(`/api/rooms/${roomName}/viewer-session`, {
    method: 'POST',
    headers: { 'X-Demystify-Viewer-Token': token },
  })

  const EditorWebSocket = createSocketClass(editorCookie)
  const ViewerWebSocket = createSocketClass(viewerCookie)
  const connectStartedAt = performance.now()
  clients.push(...await Promise.all([
    ...Array.from({ length: editorCount }, (_, index) =>
      openClient(index + 1, 'editor', EditorWebSocket)),
    ...Array.from({ length: viewerCount }, (_, index) =>
      openClient(index + 1, 'viewer', ViewerWebSocket)),
  ]))
  const connectWallMs = performance.now() - connectStartedAt
  const syncTimes = clients.map((client) => client.syncMs)

  const awarenessMs = await waitUntil(
    () => clients.every(({ provider }) => provider.awareness.getStates().size === participantCount),
    15_000,
    `${participantCount}-participant awareness convergence`,
  )

  const editors = clients.filter((client) => client.role === 'editor')
  const source = `# Collaboration load\n\n${'x'.repeat(documentSize - 23)}`
  editors[0].document.getText('content').insert(0, source)
  await waitUntil(
    () => clients.every(({ document }) => document.getText('content').toString() === source),
    10_000,
    'initial manuscript convergence',
  )

  const markers = editors.map((_, index) => `[editor-${index + 1}]`)
  const editStartedAt = performance.now()
  editors.forEach(({ document }, index) => {
    const text = document.getText('content')
    text.insert(text.length, markers[index])
  })
  const editConvergenceMs = await waitUntil(
    () => clients.every(({ document }) =>
      markers.every((marker) => document.getText('content').toString().includes(marker))),
    10_000,
    'five-editor update convergence across 95 viewers',
  )
  const editWallMs = performance.now() - editStartedAt
  assert.equal(
    new Set(clients.map(({ document }) => document.getText('content').toString())).size,
    1,
    'All editors and viewers must converge on one manuscript state.',
  )

  assert.ok(connectWallMs < 15_000, `Connection wall time was ${round(connectWallMs)} ms.`)
  assert.ok(editWallMs < 10_000, `Edit convergence was ${round(editWallMs)} ms.`)
  console.log(JSON.stringify({
    shape: { editors: editorCount, viewers: viewerCount, documentChars: source.length },
    persistence: process.env.DATABASE_URL ? 'postgresql' : 'leveldb',
    connectWallMs: round(connectWallMs),
    syncP50Ms: round(percentile(syncTimes, 0.5)),
    syncP95Ms: round(percentile(syncTimes, 0.95)),
    syncMaxMs: round(Math.max(...syncTimes)),
    awarenessMs: round(awarenessMs),
    editConvergenceMs: round(editConvergenceMs),
  }, null, 2))
} finally {
  clients.forEach(closeClient)
  await stopServer()
  await rm(temporaryDirectory, { recursive: true, force: true })
}
