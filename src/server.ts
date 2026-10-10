import express from 'express'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import cookieParser from 'cookie-parser'
import { migrate } from '../db/migrate.ts'
import { authenticate, deleteDeadSessions } from './middleware/auth.ts'
import { readYourWrites } from './middleware/replica.ts'
import { trustProxySetting } from './middleware/rate-limit.ts'
import { securityHeaders } from './middleware/security-headers.ts'
import { bodyLimit } from './limits.ts'
import { sendError } from './negotiate.ts'
import { adminRouter } from './routes/admin.ts'
import { avatarRouter } from './routes/avatar.ts'
import { blurtsRouter } from './routes/blurts.ts'
import { embedPendingBlurts } from './embeddings.ts'
import { homeRouter } from './routes/home.ts'
import { locationRouter } from './routes/location.ts'
import { profilesRouter } from './routes/profiles.ts'
import { usersRouter } from './routes/users.ts'
import { stylesheet } from './templates/styles.ts'

export const app = express()
// So request.ip is the client's address behind a reverse proxy; rate limits key on it.
app.set('trust proxy', trustProxySetting())
app.disable('x-powered-by')
// First, so every response has them, errors included.
app.use(securityHeaders)
// The stylesheet, generated from src/templates/styles.ts. Pages link it with a hash of its
// content in the URL, so it can be cached for good.
app.get('/static/style.css', (_request, response) => {
  response.type('css').set('Cache-Control', 'public, max-age=31536000, immutable').send(stylesheet)
})
// Static files (the world map) from public/, before auth: they're the same for everyone.
app.use('/static', express.static(join(import.meta.dirname, '..', 'public')))
app.use(express.urlencoded({ extended: false, limit: bodyLimit }))
app.use(express.json({ limit: bodyLimit }))
app.use(cookieParser())
app.use(readYourWrites) // before anything reads: decides replica or primary for the request
app.use(authenticate)
app.use(homeRouter)
app.use(blurtsRouter)
app.use(usersRouter)
app.use(avatarRouter)
app.use(adminRouter)
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

const port = Number(process.env.PORT) || 3000

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate()
  await deleteDeadSessions()
  void embedPendingBlurts() // catch up on blurts saved without an embedding
  app.listen(port, () => {
    console.log(`blurt.trade listening on http://localhost:${port}`)
  })
}
