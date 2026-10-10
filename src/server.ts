import express from 'express'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import cookieParser from 'cookie-parser'
import { migrate } from '../db/migrate.ts'
import { checkConfig } from './config.ts'
import { closeDb } from './db.ts'
import { errorFields, handleCrashes, log, requestLogger, serverErrorHandler } from './logging.ts'
import { authenticate, deleteDeadSessions } from './middleware/auth.ts'
import { readYourWrites } from './middleware/replica.ts'
import { trustProxySetting } from './middleware/rate-limit.ts'
import { securityHeaders } from './middleware/security-headers.ts'
import { bodyLimit } from './limits.ts'
import { sendError } from './negotiate.ts'
import { adminRouter } from './routes/admin.ts'
import { avatarRouter } from './routes/avatar.ts'
import { blurtsRouter } from './routes/blurts.ts'
import { healthRouter } from './routes/health.ts'
import { embedPendingBlurts } from './embeddings.ts'
import { homeRouter } from './routes/home.ts'
import { infoRouter } from './routes/info.ts'
import { locationRouter } from './routes/location.ts'
import { profilesRouter } from './routes/profiles.ts'
import { searchRouter } from './routes/search.ts'
import { usersRouter } from './routes/users.ts'
import { crawlRouter } from './routes/crawl.ts'

const publicDir = join(import.meta.dirname, '..', 'public')

export const app = express()
// So request.ip is the client's address behind a reverse proxy; rate limits key on it.
app.set('trust proxy', trustProxySetting())
app.disable('x-powered-by')
// First: a request id and one log line per request (src/logging.ts).
app.use(requestLogger)
// Next, so every response has them, errors included.
app.use(securityHeaders)
// Before cookies and auth: the uptime check needs neither.
app.use(healthRouter)
app.use(crawlRouter)
// Public files from public/ (css, images, map), before auth: they are the same for everyone.
// ETag handles revalidation; keep max-age at 0 so clients check before reuse.
app.use('/static', express.static(publicDir, { etag: true, immutable: false, maxAge: 0 }))
app.use(express.urlencoded({ extended: false, limit: bodyLimit }))
app.use(express.json({ limit: bodyLimit }))
app.use(cookieParser())
app.use(readYourWrites) // before anything reads: decides replica or primary for the request
app.use(authenticate)
app.use(homeRouter)
app.use(infoRouter)
app.use(blurtsRouter)
app.use(usersRouter)
app.use(avatarRouter)
app.use(adminRouter)
app.use(searchRouter)
app.use(locationRouter) // before profilesRouter, whose /:username/ would match /near
app.use(profilesRouter)
// Unknown paths, and /:username/:id URLs that matched no blurt.
app.use((request: express.Request, response: express.Response) => {
  sendError(request, response, 404, 'Not found')
})
// Client errors from middleware, e.g. a malformed JSON body or one over bodyLimit (413).
app.use(
  (
    error: { status?: unknown; message?: unknown; type?: unknown },
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => {
    if (typeof error.status !== 'number' || error.status < 400 || error.status >= 500) {
      next(error)
      return
    }
    const message =
      error.type === 'entity.too.large'
        ? `Request body is too large (at most ${bodyLimit})`
        : String(error.message)
    sendError(request, response, error.status, message)
  },
)
// Everything else: logged with its stack and request id, and a generic 500.
app.use(serverErrorHandler)

const port = Number(process.env.PORT) || 3000

// Housekeeping while the server runs. Both are cheap when there is nothing to do.
const sessionCleanupMs = 60 * 60 * 1000 // revoked and idle sessions, hourly
const embeddingCatchUpMs = 5 * 60 * 1000 // blurts left without an embedding, e.g. model failed

// Graceful shutdown: on SIGTERM (systemd stop/restart) or SIGINT, stop accepting
// connections, let requests in flight finish, close the database pools and exit. If that
// takes longer than shutdownTimeoutMs, exit anyway.
const shutdownTimeoutMs = 10_000

async function start(): Promise<void> {
  handleCrashes()
  checkConfig()
  // MIGRATE_ON_START=false when migrations run as a separate deploy step (docs/deploy.md).
  if (process.env.MIGRATE_ON_START !== 'false') {
    await migrate()
  }
  await deleteDeadSessions()
  void embedPendingBlurts() // catch up on blurts saved without an embedding

  const timers = [
    setInterval(() => {
      deleteDeadSessions().catch((error: unknown) => {
        log('error', 'deleting dead sessions failed', { error: errorFields(error) })
      })
    }, sessionCleanupMs),
    setInterval(() => void embedPendingBlurts(), embeddingCatchUpMs),
  ]

  const server = app.listen(port, () => {
    const address = server.address()
    const actualPort = address && typeof address === 'object' ? address.port : port
    log('info', 'listening', { port: actualPort })
  })

  let stopping = false
  const shutdown = (signal: string) => {
    if (stopping) {
      return
    }
    stopping = true
    log('info', 'shutting down', { signal })
    for (const timer of timers) {
      clearInterval(timer)
    }
    setTimeout(() => {
      log('error', 'shutdown timed out, exiting')
      process.exit(1)
    }, shutdownTimeoutMs).unref()
    server.close(() => {
      closeDb().then(
        () => {
          log('info', 'shut down cleanly')
          process.exit(0)
        },
        (error: unknown) => {
          log('error', 'closing the database failed', { error: errorFields(error) })
          process.exit(1)
        },
      )
    })
    server.closeIdleConnections() // keep-alive sockets with no request in flight
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start()
}
