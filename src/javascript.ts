import type { Request, Response } from 'express'
import { getJavaScriptSetting } from './middleware/auth.ts'

// "Use JavaScript": the site's JavaScript is optional, and on unless turned off. Off, the
// server sends no <script>, no import map and no module preload at all (not just code that
// switches itself off), so the page is exactly what a browser without JavaScript gets, and
// the response's CSP has no script-src (src/middleware/security-headers.ts).
//
// Logged in, it's an account setting (user_profiles.javascript), carried in the access
// token like the theme. Otherwise it's this cookie, set only while JavaScript is off.
// Turning it off or on (POST /api/javascript, src/routes/javascript.ts) always sets the
// cookie for this browser, and logged in also saves it on the account; while logged in,
// the account's setting is the one that counts.
export const javascriptCookie = 'javascript'

// The longest a browser keeps a cookie, like a kept login.
const cookieDays = 400

export function javascriptEnabled(request: Request): boolean {
  const setting = getJavaScriptSetting(request)
  if (setting !== undefined) {
    return setting
  }
  const cookies = (request.cookies ?? {}) as Record<string, unknown>
  return cookies[javascriptCookie] !== 'off'
}

export function setJavaScriptCookie(response: Response, on: boolean): void {
  const options = {
    httpOnly: true, // nothing in the page reads it
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  }
  if (on) {
    response.clearCookie(javascriptCookie, options)
  } else {
    response.cookie(javascriptCookie, 'off', { ...options, maxAge: cookieDays * 86_400_000 })
  }
}
