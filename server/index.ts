import 'dotenv/config'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import session from 'express-session'
import { WebSocketServer } from 'ws'
import { ApiError, githubRouter } from './github.js'

const persistencePath = process.env.YPERSISTENCE
if (persistencePath) {
  await mkdir(dirname(persistencePath), { recursive: true })
}

const { setupWSConnection } = await import('y-websocket/bin/utils')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const collaborationPrefix = '/collaboration/'
const sessionSecret =
  process.env.SESSION_SECRET ??
  (isProduction ? '' : 'demystify-local-development-session-secret')

if (!sessionSecret) {
  throw new Error('SESSION_SECRET is required in production.')
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(express.json({ limit: '2mb' }))
app.use(
  session({
    name: 'demystify.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1_000,
    },
  }),
)

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})
app.use('/api', githubRouter)

if (isProduction) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const distributionDirectory = join(projectRoot, 'dist')
  app.use(express.static(distributionDirectory))
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api/')) {
      next()
      return
    }
    response.sendFile(join(distributionDirectory, 'index.html'))
  })
}

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    void _next
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: error.message, details: error.details })
      return
    }

    console.error(error)
    response.status(500).json({ error: 'The server could not complete this request.' })
  },
)

const server = createServer(app)
const webSocketServer = new WebSocketServer({ noServer: true })

webSocketServer.on('connection', (socket, request) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)
  let roomName = ''
  try {
    roomName = decodeURIComponent(requestUrl.pathname.slice(collaborationPrefix.length))
  } catch {
    socket.close(1008, 'A valid document room is required')
    return
  }

  if (!/^[A-Za-z0-9_-]{8,100}$/.test(roomName)) {
    socket.close(1008, 'A valid document room is required')
    return
  }

  setupWSConnection(socket, request, { docName: roomName })
})

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (!requestUrl.pathname.startsWith(collaborationPrefix)) {
    socket.destroy()
    return
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    webSocketServer.emit('connection', webSocket, request)
  })
})

server.listen(port, host, () => {
  console.log(`DeMystify server listening on http://${host}:${port}`)
})