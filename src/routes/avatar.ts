import { Router } from 'express'
import { type Avatar, avatarSchema, randomAvatar } from '../avatar.ts'
import { clearSessionCookies, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import {
  type FieldError,
  fieldErrors,
  sendError,
  sendFormErrors,
  sendFormSuccess,
  wantsJson,
} from '../negotiate.ts'
import { getNotificationSettings } from './state/notifications.ts'
import { getLocation, getUserProfileByUsername, setAvatar } from './state/profiles.ts'
import { renderProfileEditPage } from '../pages/profile-edit/profile-edit.html.ts'

export const avatarRouter = Router()

function isGiven(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && value !== false
}

// The avatar a form or JSON body asks for: every field, or `random` for a new random one.
// Also for a bot's avatar, which its owners set (src/routes/bots.ts).
export function avatarFromBody(body: unknown): { avatar: Avatar } | { errors: FieldError[] } {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (isGiven(fields.random)) {
    return { avatar: randomAvatar() }
  }
  const result = avatarSchema.safeParse(fields)
  return result.success ? { avatar: result.data } : { errors: fieldErrors(result.error) }
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
    const parsed = avatarFromBody(request.body)
    if ('errors' in parsed) {
      const profile = await getUserProfileByUsername(viewer.username)
      if (!profile) {
        sendError(request, response, 404, 'User not found')
        return
      }
      const location = await getLocation(viewer.id)
      const notifications = await getNotificationSettings(viewer.id)
      await sendFormErrors(request, response, parsed.errors, (avatarError) =>
        renderProfileEditPage({ viewer, profile, location, notifications, avatarError }),
      )
      return
    }
    const { avatar } = parsed

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
