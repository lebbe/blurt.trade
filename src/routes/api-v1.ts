import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import { getViewer } from '../middleware/auth.ts'
import { sendError } from '../negotiate.ts'
import { parseBlurtId } from './blurts.ts'
import { getBlurt } from './state/blurts.ts'

// The bot API: REST-shaped JSON for bot accounts, with `Authorization: Bearer <token>`
// (tokens are minted on /settings, src/routes/state/bots.ts). Every route here is a thin
// alias: it rewrites the method, URL and body to the site's own route for the same thing
// and lets the app handle it from there, so validation, rate limits, notifications and the
// JSON are exactly the site's. Answers are always JSON (src/server.ts sets Accept), and the
// JSON is what the same page or action gives, see docs/routes.md. docs/api.md lists them.
//
// Mounted on the app without a path, so a rewritten URL carries on to the routers after it
// (Express only puts a mount path back, never a URL a handler set).
export const apiV1Router = Router()

// Bots only: authenticate reads nothing but the bearer token on /api/v1/, and only finds a
// user for a live token of a bot account.
apiV1Router.use('/api/v1', (request: Request, response: Response, next: NextFunction) => {
  if (getViewer(request)) {
    next()
    return
  }
  response.set('WWW-Authenticate', 'Bearer')
  sendError(request, response, 401, 'A bot API token is required: Authorization: Bearer <token>')
})

type Target = { method: 'GET' | 'POST'; path: string; body?: Record<string, unknown> }

// Sends the request on to `target`, keeping its query string (cursors: before, after).
// Undefined from `to`: a 404.
function alias(to: (request: Request) => Target | undefined | Promise<Target | undefined>) {
  const handler: RequestHandler = async (request, response, next) => {
    const target = await to(request)
    if (!target) {
      sendError(request, response, 404, 'Not found')
      return
    }
    const query = request.url.indexOf('?')
    request.method = target.method
    request.url = target.path + (query === -1 ? '' : request.url.slice(query))
    if (target.body) {
      request.body = { ...request.body, ...target.body }
    }
    next()
  }
  return handler
}

const get = (path: string): Target => ({ method: 'GET', path })
const post = (path: string, body?: Record<string, unknown>): Target => ({
  method: 'POST',
  path,
  body,
})
const me = (request: Request) => getViewer(request)!.username
const user = (request: Request) => encodeURIComponent(request.params.username as string)

// A blurt's page is /:username/:id, so look up whose it is first.
async function blurtPage(request: Request): Promise<Target | undefined> {
  const id = parseBlurtId(request.params.id)
  const blurt = id === undefined ? undefined : await getBlurt(id)
  return blurt && blurt.id === id
    ? get(`/${encodeURIComponent(blurt.username ?? 'deleted')}/${id}`)
    : undefined
}

const v1 = apiV1Router

v1.get(
  '/api/v1/me',
  alias((r) => get(`/${me(r)}/`)),
)
v1.get(
  '/api/v1/feed',
  alias(() => get('/')),
)
v1.get(
  '/api/v1/feed/everyone',
  alias(() => get('/everyone')),
)
v1.get(
  '/api/v1/search',
  alias(() => get('/search')),
)
v1.get(
  '/api/v1/notifications',
  alias((r) => get(`/${me(r)}/notifications/`)),
)
v1.post(
  '/api/v1/notifications/read',
  alias(() => post('/api/notifications/read')),
)

v1.post(
  '/api/v1/blurts',
  alias(() => post('/api/blurts')),
)
v1.get('/api/v1/blurts/:id', alias(blurtPage))
v1.delete(
  '/api/v1/blurts/:id',
  alias((r) => post(`/api/blurts/${r.params.id}/delete`)),
)
v1.put(
  '/api/v1/blurts/:id/like',
  alias((r) => post('/api/like', { blurtId: r.params.id })),
)
v1.delete(
  '/api/v1/blurts/:id/like',
  alias((r) => post('/api/unlike', { blurtId: r.params.id })),
)
v1.put(
  '/api/v1/blurts/:id/reblurt',
  alias((r) => post('/api/reblurt', { blurtId: r.params.id })),
)
v1.delete(
  '/api/v1/blurts/:id/reblurt',
  alias((r) => post('/api/unreblurt', { blurtId: r.params.id })),
)

v1.get(
  '/api/v1/users/:username',
  alias((r) => get(`/${user(r)}/`)),
)
v1.put(
  '/api/v1/users/:username/follow',
  alias((r) => post('/api/follow', { username: r.params.username })),
)
v1.delete(
  '/api/v1/users/:username/follow',
  alias((r) => post('/api/unfollow', { username: r.params.username })),
)

// Anything else under /api/v1/ (rewritten requests have left it by now).
v1.use('/api/v1', (request: Request, response: Response) => {
  sendError(request, response, 404, 'Not found')
})
