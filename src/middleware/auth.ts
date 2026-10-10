import { jwtVerify, SignJWT } from 'jose'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { sendError } from '../negotiate.ts'
import type { User } from '../routes/state.ts'

export const accessTokenCookie = 'access_token'
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET || 'development-only-secret')

export type AuthenticatedUser = {
  id: number
  username: string
}

export function readAccessToken(cookieHeader: string | undefined): string | undefined {
  const cookie = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${accessTokenCookie}=`))

  return cookie ? decodeURIComponent(cookie.slice(accessTokenCookie.length + 1)) : undefined
}

export async function createAccessToken(user: User): Promise<string> {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(jwtSecret)
}

export async function getAuthenticatedUser(token: unknown): Promise<AuthenticatedUser | undefined> {
  if (typeof token !== 'string') {
    return undefined
  }

  try {
    const { payload } = await jwtVerify(token, jwtSecret)
    const userId = Number(payload.sub)
    return Number.isSafeInteger(userId) && typeof payload.username === 'string'
      ? { id: userId, username: payload.username }
      : undefined
  } catch {
    return undefined
  }
}

// The logged-in user, or null (not undefined, so it survives JSON) for anonymous visitors.
export async function getViewer(request: Request): Promise<AuthenticatedUser | null> {
  return (await getAuthenticatedUser(readAccessToken(request.headers.cookie))) ?? null
}

export const requireAuth: RequestHandler = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  getAuthenticatedUser(readAccessToken(request.headers.cookie))
    .then((user) => {
      if (!user) {
        sendError(request, response, 401, 'Authentication required')
        return
      }

      response.locals.authenticatedUser = user
      next()
    })
    .catch(next)
}

export function setAccessToken(
  response: { cookie: (name: string, value: string, options: object) => void },
  token: string,
): void {
  response.cookie(accessTokenCookie, token, accessTokenCookieOptions(15 * 60 * 1000))
}

export function clearAccessToken(response: {
  cookie: (name: string, value: string, options: object) => void
}): void {
  response.cookie(accessTokenCookie, '', accessTokenCookieOptions(0))
}

function accessTokenCookieOptions(maxAge: number): object {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  }
}
