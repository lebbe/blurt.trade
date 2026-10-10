import express from 'express'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import cookieParser from 'cookie-parser'
import { migrate } from '../db/migrate.ts'
import { authenticate, deleteDeadSessions } from './middleware/auth.ts'
import { sendError } from './negotiate.ts'
import { blurtsRouter } from './routes/blurts.ts'
import { embedPendingBlurts } from './embeddings.ts'
import { homeRouter } from './routes/home.ts'
import { locationRouter } from './routes/location.ts'
import { profilesRouter } from './routes/profiles.ts'
import { usersRouter } from './routes/users.ts'

export const app = express()
// Static files (the world map) from public/, before auth: they're the same for everyone.
app.use('/static', express.static(join(import.meta.dirname, '..', 'public')))
app.use(express.urlencoded({ extended: false }))
app.use(express.json())
app.use(cookieParser())
app.use(authenticate)
app.use(homeRouter)
app.use(blurtsRouter)
app.use(usersRouter)
app.use(locationRouter) // before profilesRouter, whose /:username/ would match /near
app.use(profilesRouter)
// Unknown paths, and /:username/:id URLs that matched no blurt.
app.use((request: express.Request, response: express.Response) => {
  sendError(request, response, 404, 'Not found')
})
// Client errors from middleware, e.g. a malformed JSON body.
app.use(
  (
    error: { status?: unknown; message?: unknown },
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => {
    if (typeof error.status !== 'number' || error.status < 400 || error.status >= 500) {
      next(error)
      return
    }
    sendError(request, response, error.status, String(error.message))
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
