import type { NextFunction, Request, Response } from 'express'
import { readFromPrimary } from '../db.ts'

// Read-your-own-writes with a read replica. A form POST redirects (303) to a page whose
// feed is read from the replica, which may not have the new blurt yet. So any request that
// can write (not GET or HEAD) sets a short-lived cookie, and while a browser has it, its
// reads go to the primary too. The redirect that follows a POST carries the cookie
// (SameSite=Lax allows it on same-site navigations), so the poster always sees their own
// blurt, follow or location change. Everyone else may see it a moment later.
//
// The window only has to outlast the replica's lag, normally well under a second. If the
// replica falls further behind than this, pages may briefly miss a user's own changes; see
// db/README.md, Read replica.
export const recentWriteCookie = 'recent_write'
export const recentWriteSeconds = Number(process.env.READ_YOUR_WRITES_SECONDS) || 10

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

// Sets the cookie as the headers go out. For a GET that writes (visiting a blurt reads its
// notifications), since only unsafe methods get it from readYourWrites.
export function markRecentWrite(response: Response): void {
  // Added last, as the headers go out, so the route's own cookies (the session) come first.
  const writeHead = response.writeHead
  response.writeHead = function (this: Response, ...args: Parameters<typeof writeHead>) {
    this.cookie(recentWriteCookie, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: recentWriteSeconds * 1000,
    })
    return writeHead.apply(this, args)
  } as typeof writeHead
}

export function readYourWrites(request: Request, response: Response, next: NextFunction): void {
  const writes = !safeMethods.has(request.method)
  if (writes) {
    markRecentWrite(response)
  }
  if (writes || request.cookies?.[recentWriteCookie] !== undefined) {
    readFromPrimary(next)
  } else {
    next()
  }
}
