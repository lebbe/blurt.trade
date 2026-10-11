import { Router } from 'express'
import { requireAuth } from '../middleware/auth.ts'
import { sendError, sendFormSuccess } from '../negotiate.ts'
import { isTheme, themeCookie } from '../themes.ts'

export const themeRouter = Router()

const themeCookieMaxAge = 400 * 24 * 60 * 60 * 1000 // as long as browsers keep a cookie

// The theme picker on the profile edit page: a plain form POST that keeps the pick in a
// cookie for this browser (no database, nothing to sync), then goes back to the edit page,
// now in the new colours. JSON callers get `{ theme }`.
themeRouter.post('/api/theme', requireAuth, (request, response) => {
  const viewer = response.locals.authenticatedUser
  const theme: unknown = request.body?.theme
  if (!isTheme(theme)) {
    sendError(request, response, 400, 'Unknown theme', 'theme')
    return
  }
  response.cookie(themeCookie, theme, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: themeCookieMaxAge,
  })
  sendFormSuccess(request, response, {
    redirect: `/${viewer.username}/edit#theme`,
    data: { theme },
  })
})
