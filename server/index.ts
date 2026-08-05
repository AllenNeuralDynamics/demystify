import 'dotenv/config'
import { mkdir } from 'node:fs/promises'
import { createServer, ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import session from 'express-session'
import { WebSocketServer } from 'ws'
import { ApiError, githubRouter } from './github.js'
import {
  authorizeRoomRequest,
  createRoomRouter,
  RoomStore,
  validateRoomName,
} from './rooms.js'

const persistencePath = process.env.YPERSISTENCE
if (persistencePath) {
  await mkdir(dirname(persistencePath), { recursive: true })
}

const { setupWSConnection } = await import('y-websocket/bin/utils')
const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const collaborationPrefix = '/collaboration/'
const roomStore = new RoomStore(process.env.ROOMS_PATH ?? '.data/rooms.json')
await roomStore.initialize()
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
const sessionMiddleware = session({
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
})
app.use(sessionMiddleware)

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})
if (process.env.NODE_ENV === 'test' && process.env.ENABLE_TEST_AUTH === '1') {
  app.post('/api/test/session', (request, response, next) => {
    const id =
      typeof request.body.id === 'number' && Number.isSafeInteger(request.body.id)
        ? request.body.id
        : 1
    const login =
      typeof request.body.login === 'string' && request.body.login.trim()
        ? request.body.login.trim()
        : 'integration-test'
    request.session.github = {
      accessToken: 'test-token',
      user: {
        id,
        login,
        name: 'Integration Test',
        avatarUrl: '',
      },
    }
    request.session.save((error) => {
      if (error) next(error)
      else response.status(204).end()
    })
  })
}
app.use('/api', createRoomRouter(roomStore))
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
    roomName = validateRoomName(
      decodeURIComponent(requestUrl.pathname.slice(collaborationPrefix.length)),
    )
  } catch {
    socket.close(1008, 'A valid document room is required')
    return
  }

  setupWSConnection(socket, request, { docName: roomName })
})

const rejectUpgrade = (
  socket: import('node:stream').Duplex,
  status: number,
  message: string,
) => {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  )
  socket.destroy()
}

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (!requestUrl.pathname.startsWith(collaborationPrefix)) {
    socket.destroy()
    return
  }

  let roomName = ''
  try {
    roomName = validateRoomName(
      decodeURIComponent(requestUrl.pathname.slice(collaborationPrefix.length)),
    )
  } catch {
    rejectUpgrade(socket, 400, 'Invalid collaboration room')
    return
  }

  const response = new ServerResponse(request)
  sessionMiddleware(
    request as express.Request,
    response as unknown as express.Response,
    async (sessionError) => {
      if (sessionError) {
        rejectUpgrade(socket, 500, 'Session lookup failed')
        return
      }

      try {
        await authorizeRoomRequest(request as express.Request, roomStore, roomName)
      } catch (error) {
        const status = error instanceof ApiError ? error.status : 500
        rejectUpgrade(socket, status, status === 401 ? 'Unauthorized' : 'Forbidden')
        return
      }

      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit('connection', webSocket, request)
      })
    },
  )
})

server.listen(port, host, () => {
  console.log(`DeMystify server listening on http://${host}:${port}`)
})