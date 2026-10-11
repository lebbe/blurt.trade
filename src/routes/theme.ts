import { Router } from 'express'
import { clearSessionCookies, requireAuth, setSessionTheme } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import { isTheme } from '../themes.ts'
import { setTheme } from './state.ts'

export const themeRouter = Router()

// The theme picker on the profile edit page: a plain form POST. The theme is saved on the
// account (user_profiles.theme) and travels in the access token, which is reissued here
// so the edit page it goes back to is already in the new colours. Other devices get it
// at their next token refresh. JSON callers get `{ theme }`.
themeRouter.post(
  '/api/theme',
  requireAuth,
  rateLimit('theme', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const theme: unknown = request.body?.theme
    if (!isTheme(theme)) {
      sendError(request, response, 400, 'Unknown theme', 'theme')
      return
    }
    if (!(await setTheme(viewer.id, theme))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }
    await setSessionTheme(request, response, theme)
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#theme`,
      data: { theme },
    })
  },
)
