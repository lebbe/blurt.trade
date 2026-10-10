import { hkdfSync } from 'node:crypto'
import { jwtVerify, SignJWT, type JWTPayload } from 'jose'
import type { CookieOptions, NextFunction, Request, RequestHandler, Response } from 'express'
import { db } from '../db.ts'
import { sendError } from '../negotiate.ts'
import { isAdmin } from '../routes/state.ts'

// Two tokens, each in its own HttpOnly cookie:
//
// - The access token is a short-lived JWT, checked by its signature alone. No database
//   call, so nearly every request stays stateless.
// - The refresh token is a JWT naming a row in `sessions` and a generation. When the access
//   token has run out, `authenticate` trades the refresh token for a new pair and moves the
//   row's current_generation on by one. From then on only the new generation is valid.
//
// An older generation showing up means two copies of the session exist, so one of them is
// stolen. There's no telling which, so the whole session is revoked and both sides have to
// log in again. The exception is the generation just before the current one, within a few
// seconds of the rotation: that is tabs racing each other in the same browser. It gets a
// new access token but no refresh token. The browser already has the new refresh token
// from the request that won, and a thief racing in that window gets 5 minutes, not the
// session.
//
// Sessions never expire while they're used: every refresh restarts a 400-day clock, the
// longest a browser keeps a cookie. Revoking a session (log out, log out everywhere, a
// replayed token) takes effect at its next refresh, so within the access token's lifetime.

const production = process.env.NODE_ENV === 'production'

// Anyone holding the secret can log in as anyone, so production refuses to start without
// a real one.
if (production && (process.env.JWT_SECRET ?? '').length < 32) {
  throw new Error('Set JWT_SECRET to at least 32 random characters: openssl rand -base64 48')
}
const secret = process.env.JWT_SECRET || 'development-only-secret'

// One key per token type, so an access token can never pass for a refresh token or the
// other way around.
function deriveKey(purpose: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, 'blurt.trade', purpose, 32))
}
const accessKey = deriveKey('access token')
const refreshKey = deriveKey('refresh token')

const accessTokenSeconds = 5 * 60
const sessionIdleSeconds = 400 * 24 * 60 * 60
// How long after a rotation the previous refresh token still counts as a racing tab.
const raceWindowSeconds = 20

// The refresh cookie goes with every request, not just to a refresh path: a form POST or a
// page load with an expired access token must refresh in place, without JS or a redirect.
// In production both are __Host- cookies (Secure, Path=/, no Domain), so neither a
// subdomain nor a plain-http response can plant or overwrite them.
const cookiePrefix = production ? '__Host-' : ''
export const accessTokenCookie = `${cookiePrefix}access_token`
export const refreshTokenCookie = `${cookiePrefix}refresh_token`

export type AuthenticatedUser = {
  id: number
  username: string
}

// The session id stays out of AuthenticatedUser, which goes out as `viewer` in page JSON.
type Session = { user: AuthenticatedUser; sessionId: string }

type RefreshClaims = { userId: number; sessionId: string; generation: number }

// Filled in by `authenticate` for each request that carries a valid session.
const sessions = new WeakMap<Request, Session>()

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function verifyJwt(token: unknown, key: Uint8Array): Promise<JWTPayload | undefined> {
  if (typeof token !== 'string') {
    return undefined
  }
  try {
    return (await jwtVerify(token, key, { algorithms: ['HS256'] })).payload
  } catch {
    return undefined
  }
}

function signJwt(
  key: Uint8Array,
  claims: JWTPayload,
  subject: number,
  lifetimeSeconds: number,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(subject))
    .setIssuedAt()
    .setExpirationTime(`${lifetimeSeconds}s`)
    .sign(key)
}

function userIdFrom(payload: JWTPayload): number | undefined {
  return typeof payload.sub === 'string' && /^\d{1,15}$/.test(payload.sub)
    ? Number(payload.sub)
    : undefined
}

async function verifyAccessToken(token: unknown): Promise<Session | undefined> {
  const payload = await verifyJwt(token, accessKey)
  const id = payload && userIdFrom(payload)
  return id !== undefined &&
    typeof payload?.username === 'string' &&
    typeof payload.sid === 'string'
    ? { user: { id, username: payload.username }, sessionId: payload.sid }
    : undefined
}

async function verifyRefreshToken(token: unknown): Promise<RefreshClaims | undefined> {
  const payload = await verifyJwt(token, refreshKey)
  const userId = payload && userIdFrom(payload)
  return userId !== undefined &&
    typeof payload?.sid === 'string' &&
    uuidPattern.test(payload.sid) &&
    Number.isSafeInteger(payload.gen)
    ? { userId, sessionId: payload.sid, generation: payload.gen as number }
    : undefined
}

function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  }
}

// A new access token, and a refresh token too unless `generation` is left out.
async function setSessionCookies(
  response: Response,
  { user, sessionId }: Session,
  generation?: number,
): Promise<void> {
  const accessToken = await signJwt(
    accessKey,
    { username: user.username, sid: sessionId },
    user.id,
    accessTokenSeconds,
  )
  response.cookie(accessTokenCookie, accessToken, cookieOptions(accessTokenSeconds))
  if (generation !== undefined) {
    const refreshToken = await signJwt(
      refreshKey,
      { sid: sessionId, gen: generation },
      user.id,
      sessionIdleSeconds,
    )
    response.cookie(refreshTokenCookie, refreshToken, cookieOptions(sessionIdleSeconds))
  }
  // A shared cache must never keep a response that hands out someone's tokens.
  response.set('Cache-Control', 'no-store')
}

export function clearSessionCookies(response: Response): void {
  response.cookie(accessTokenCookie, '', cookieOptions(0))
  response.cookie(refreshTokenCookie, '', cookieOptions(0))
  response.set('Cache-Control', 'no-store')
}

// Trades a refresh token for its session and the generation of the next refresh token
// (undefined for a racing tab, which gets none). Undefined altogether means log out.
async function refreshSession(
  claims: RefreshClaims,
): Promise<{ session: Session; generation: number | undefined } | undefined> {
  const { userId, sessionId, generation } = claims
  // Only one of several requests racing with the same token gets past the WHERE: the row
  // lock makes the others re-check it after the first one's update.
  const rotated = await db().query<{ generation: number; username: string }>(
    `UPDATE sessions s
     SET current_generation = s.current_generation + 1, last_used_at = now()
     FROM users u
     WHERE s.id = $1 AND s.user_id = $2 AND u.id = s.user_id
       AND s.current_generation = $3 AND s.revoked_at IS NULL
       AND s.last_used_at > now() - $4 * interval '1 second'
     RETURNING s.current_generation AS generation, u.username`,
    [sessionId, userId, generation, sessionIdleSeconds],
  )
  if (rotated.rows[0]) {
    const { generation: next, username } = rotated.rows[0]
    return { session: { user: { id: userId, username }, sessionId }, generation: next }
  }

  const { rows } = await db().query<{
    current: number
    username: string
    active: boolean
    racing: boolean
  }>(
    `SELECT s.current_generation AS current, u.username,
       s.revoked_at IS NULL AND s.last_used_at > now() - $3 * interval '1 second' AS active,
       s.last_used_at > now() - $4 * interval '1 second' AS racing
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [sessionId, userId, sessionIdleSeconds, raceWindowSeconds],
  )
  const row = rows[0]
  if (!row?.active) {
    return undefined // logged out, revoked, idle for too long, or the user is gone
  }
  if (generation === row.current - 1 && row.racing) {
    return {
      session: { user: { id: userId, username: row.username }, sessionId },
      generation: undefined,
    }
  }
  // An older generation after the race window: someone else has a copy of this session.
  await db().query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
  ])
  return undefined
}

async function resolveSession(request: Request, response: Response): Promise<Session | undefined> {
  const cookies = (request.cookies ?? {}) as Record<string, unknown>
  const session = await verifyAccessToken(cookies[accessTokenCookie])
  if (session || cookies[refreshTokenCookie] === undefined) {
    return session
  }

  const claims = await verifyRefreshToken(cookies[refreshTokenCookie])
  const refreshed = claims && (await refreshSession(claims))
  if (!refreshed) {
    clearSessionCookies(response)
    return undefined
  }
  await setSessionCookies(response, refreshed.session, refreshed.generation)
  return refreshed.session
}

// Runs before every route: works out who is logged in, refreshing the tokens on the way
// when the access token has run out. Form POSTs, page loads and fetch() all work the same,
// since the browser sends the cookies with each of them.
export const authenticate: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  resolveSession(request, response)
    .then((session) => {
      if (session) {
        sessions.set(request, session)
      }
      next()
    })
    .catch(next)
}

// The logged-in user, or null (not undefined, so it survives JSON) for anonymous visitors.
export function getViewer(request: Request): AuthenticatedUser | null {
  return sessions.get(request)?.user ?? null
}

export const requireAuth: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const user = getViewer(request)
  if (!user) {
    sendError(request, response, 401, 'Authentication required')
    return
  }
  response.locals.authenticatedUser = user
  next()
}

// For moderation pages and actions. The admin flag is read from the primary database on
// each request, not kept in the token, so taking it away works at once.
export const requireAdmin: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  requireAuth(request, response, () => {
    isAdmin(response.locals.authenticatedUser.id)
      .then((admin) => {
        if (admin) {
          next()
        } else {
          sendError(request, response, 403, 'Forbidden')
        }
      })
      .catch(next)
  })
}

// Login and sign-up. The session this browser had before, if any, ends.
export async function startSession(
  request: Request,
  response: Response,
  { id, username }: AuthenticatedUser,
): Promise<void> {
  await revokeCurrentSession(request)
  const { rows } = await db().query<{ id: string }>(
    'INSERT INTO sessions (user_id) VALUES ($1) RETURNING id',
    [id],
  )
  await setSessionCookies(response, { user: { id, username }, sessionId: rows[0].id }, 0)
}

async function revokeCurrentSession(request: Request): Promise<void> {
  const session = sessions.get(request)
  if (session) {
    await db().query(
      'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
      [session.sessionId],
    )
  }
}

export async function endSession(request: Request, response: Response): Promise<void> {
  await revokeCurrentSession(request)
  clearSessionCookies(response)
}

// Every browser and device the user is logged in on is logged out within the access
// token's lifetime, this one at once.
export async function endAllSessions(userId: number, response: Response): Promise<void> {
  await db().query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  )
  clearSessionCookies(response)
}

export async function countActiveSessions(userId: number): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL
       AND last_used_at > now() - $2 * interval '1 second'`,
    [userId, sessionIdleSeconds],
  )
  return rows[0].count
}

// Revoked and idle rows can never be used again. Run at startup and hourly (src/server.ts).
export async function deleteDeadSessions(): Promise<void> {
  await db().query(
    `DELETE FROM sessions
     WHERE revoked_at IS NOT NULL OR last_used_at < now() - $1 * interval '1 second'`,
    [sessionIdleSeconds],
  )
}
