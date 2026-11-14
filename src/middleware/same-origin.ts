import type { NextFunction, Request, Response } from 'express'
import { publicUrl } from '../config.ts'
import { sendError } from '../negotiate.ts'

// Refuses state-changing requests (POST and anything else that isn't GET, HEAD or
// OPTIONS) that a browser says come from another site: a 403 when the Origin header is
// there and is neither our public origin (PUBLIC_URL) nor the origin the request was sent
// to (its protocol and Host, for localhost and other names the app answers on).
//
// Every browser today sends Origin with a POST, from a form or fetch(), so a page on
// another site can't post a form at us and have it count. The session cookies are
// SameSite=Lax as well, which already keeps them off cross-site POSTs; this is the second
// lock, and it also covers what Lax doesn't: the anonymous JavaScript cookie, a sibling
// subdomain (same site, other origin) and `Origin: null` (sandboxed frames, opaque
// redirects). A request without Origin is let through: old browsers, curl, API clients
// and the tests, none of which a cross-site page can make a browser send.
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

function ownOrigins(request: Request): string[] {
  const origins = [new URL(publicUrl()).origin]
  const host = request.get('Host')
  if (host) {
    origins.push(`${request.protocol}://${host}`)
  }
  return origins
}

export function sameOriginWrites(request: Request, response: Response, next: NextFunction): void {
  const origin = request.get('Origin')
  if (safeMethods.has(request.method) || origin === undefined) {
    next()
    return
  }
  if (ownOrigins(request).includes(origin)) {
    next()
    return
  }
  sendError(request, response, 403, 'Requests from other sites are not accepted')
}
