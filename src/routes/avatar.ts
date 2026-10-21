import { Router } from 'express'
import { avatarSchema, randomAvatar } from '../avatar.ts'
import { clearSessionCookies, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { fieldErrors, sendError, sendFormErrors, sendFormSuccess, wantsJson } from '../negotiate.ts'
import {
  getLocation,
  getNotificationSettings,
  getUserProfileByUsername,
  setAvatar,
} from './state.ts'
import { renderProfileEditPage } from '../templates/index.ts'

export const avatarRouter = Router()

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false
}

// Saves the viewer's avatar from the edit page's avatar form: every field (the form always
// sends them all), or `random` (the form's "Random" button, or JSON `{ random: true }`)
// for a new random one from the same palettes as sign-up. A plain form POST either way,
// so both work without JS. Forms go back to the edit page, which shows the new avatar;
// JSON callers get `{ avatar }`.
avatarRouter.post(
  '/api/avatar',
  requireAuth,
  rateLimit('avatar', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const body = typeof request.body === 'object' && request.body !== null ? request.body : {}

    let avatar
    if (isGiven(body.random)) {
      avatar = randomAvatar()
    } else {
      const result = avatarSchema.safeParse(body)
      if (!result.success) {
        const profile = await getUserProfileByUsername(viewer.username)
        if (!profile) {
          sendError(request, response, 404, 'User not found')
          return
        }
        const location = await getLocation(viewer.id)
        const notifications = await getNotificationSettings(viewer.id)
        await sendFormErrors(request, response, fieldErrors(result.error), (avatarError) =>
          renderProfileEditPage({ viewer, profile, location, notifications, avatarError }),
        )
        return
      }
      avatar = result.data
    }

    if (!(await setAvatar(viewer.id, avatar))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }

    sendFormSuccess(request, response, { redirect: `/${viewer.username}/edit`, data: { avatar } })
  },
)
