import express from 'express'
import { pathToFileURL } from 'node:url'
import cookieParser from 'cookie-parser'
import { migrate } from '../db/migrate.ts'
import { ValidationError } from './middleware/validate.ts'
import { blurtsRouter } from './routes/blurts.ts'
import { listFeed } from './routes/state.ts'
import { embedPendingBlurts } from './embeddings.ts'
import { homeRouter } from './routes/home.ts'
import { profilesRouter } from './routes/profiles.ts'
import { usersRouter } from './routes/users.ts'
import { renderCreateUserPage, renderFeedPage, renderLoginPage } from './templates/index.ts'

export const app = express()
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())
app.use(homeRouter)
app.use(blurtsRouter)
app.use(usersRouter)
app.use(profilesRouter)
app.use(
  async (
    error: unknown,
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => {
    if (!(error instanceof ValidationError)) {
      next(error)
      return
    }

    const input = typeof error.input === 'object' && error.input !== null ? error.input : {}
    const values = input as Record<string, unknown>
    if (request.path === '/login') {
      response
        .status(400)
        .type('html')
        .send(
          renderLoginPage({
            username: typeof values.username === 'string' ? values.username : '',
            validationError: error.message,
          }),
        )
      return
    }

    if (request.path === '/createUser') {
      response
        .status(400)
        .type('html')
        .send(
          renderCreateUserPage({
            username: typeof values.username === 'string' ? values.username : '',
            validationError: error.message,
          }),
        )
      return
    }

    response
      .status(400)
      .type('html')
      .send(
        renderFeedPage(
          await listFeed(),
          {
            text: typeof values.text === 'string' ? values.text : '',
            validationError: error.message,
          },
          true,
        ),
      )
  },
)

const port = Number(process.env.PORT) || 3000

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate()
  void embedPendingBlurts() // catch up on blurts saved without an embedding
  app.listen(port, () => {
    console.log(`blurt.trade listening on http://localhost:${port}`)
  })
}
