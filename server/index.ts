import 'dotenv/config'
import { mkdir } from 'node:fs/promises'
import { createServer, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import express from 'express'
import session from 'express-session'
import { WebSocketServer } from 'ws'
import {
  createDatabasePool,
  createPostgresSessionStore,
  LocalYjsPersistence,
  PostgresYjsPersistence,
  type ReadyYjsPersistence,
  verifyDatabaseConnection,
} from './database.js'
import { ApiError, githubRouter } from './github.js'
import {
  authorizeRoomRequest,
  createRoomRouter,
  PostgresRoomStore,
  RoomStore,
  validateRoomName,
} from './rooms.js'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const isProduction = process.env.NODE_ENV === 'production'
const collaborationPrefix = '/collaboration/'
const databasePool = createDatabasePool()
const localPersistencePath = databasePool
  ? null
  : (process.env.YPERSISTENCE ?? '.data/yjs')

if (isProduction && !databasePool) {
  throw new Error('PostgreSQL configuration is required in production.')
}

if (databasePool) {
  await verifyDatabaseConnection(databasePool)
  databasePool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error)
  })
  delete process.env.YPERSISTENCE
} else {
  await mkdir(dirname(localPersistencePath as string), { recursive: true })
  delete process.env.YPERSISTENCE
}

const { docs, getYDoc, setPersistence, setupWSConnection } = await import(
  'y-websocket/bin/utils'
)
let yjsPersistence: ReadyYjsPersistence | null = null
if (databasePool) {
  const postgresPersistence = new PostgresYjsPersistence(databasePool)
  await postgresPersistence.initialize()
  yjsPersistence = postgresPersistence
  setPersistence(yjsPersistence)
  console.log('Persisting rooms, sessions, and Yjs updates in PostgreSQL')
} else {
  yjsPersistence = new LocalYjsPersistence(localPersistencePath as string)
  setPersistence(yjsPersistence)
  console.log(`Persisting Yjs updates in LevelDB at ${localPersistencePath}`)
}

const roomStore = databasePool
  ? new PostgresRoomStore(databasePool)
  : new RoomStore(process.env.ROOMS_PATH ?? '.data/rooms.json')
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
  ...(databasePool ? { store: createPostgresSessionStore(databasePool) } : {}),
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
  const distributionDirectory = join(process.cwd(), 'dist')
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

      let document: ReturnType<typeof getYDoc> | null = null
      try {
        await authorizeRoomRequest(request as express.Request, roomStore, roomName)
        if (yjsPersistence) {
          document = getYDoc(roomName)
          await yjsPersistence.waitForHydration(document)
        }
      } catch (error) {
        if (document && docs.get(roomName) === document) {
          docs.delete(roomName)
          document.destroy()
        }
        if (!(error instanceof ApiError)) {
          console.error(`Could not restore Yjs room ${roomName}:`, error)
        }
        const status = error instanceof ApiError ? error.status : 500
        rejectUpgrade(
          socket,
          status,
          status === 401
            ? 'Unauthorized'
            : status === 403
              ? 'Forbidden'
              : 'Collaboration room unavailable',
        )
        return
      }

      if (socket.destroyed) return
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit('connection', webSocket, request)
      })
    },
  )
})

server.listen(port, host, () => {
  console.log(`DeMystify server listening on http://${host}:${port}`)
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true

  for (const client of webSocketServer.clients) {
    client.close(1001, 'Server shutting down')
  }
  server.close(() => {
    const closePersistence =
      yjsPersistence instanceof LocalYjsPersistence
        ? yjsPersistence.destroy()
        : Promise.resolve()
    void Promise.all([databasePool?.end(), closePersistence]).finally(() =>
      process.exit(0),
    )
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)