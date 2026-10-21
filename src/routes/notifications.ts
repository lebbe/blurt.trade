import { Router } from 'express'
import { clearSessionCookies, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { represent, sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationsRead,
  parseCursor,
  setNotificationSettings,
  type NotificationSettings,
} from './state.ts'
import { renderNotificationsPage } from '../templates/index.ts'
import { notificationsMarkdown } from '../templates/pages.md.ts'

export const notificationsRouter = Router()

// /:username/notifications/, the owner's only. The unread ones, newest first, or with
// ?read=1 the ones already read. `before` pages through either (a cursor, like the feeds).
notificationsRouter.get('/:username/notifications/', requireAuth, async (request, response) => {
  const viewer = response.locals.authenticatedUser
  if (request.params.username.toLowerCase() !== viewer.username.toLowerCase()) {
    sendError(request, response, 403, 'Forbidden')
    return
  }
  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'before')
    return
  }
  const read = request.query.read === '1'
  const [{ items: notifications, next }, unread] = await Promise.all([
    listNotifications(viewer.id, read, before),
    countUnreadNotifications(viewer.id),
  ])
  represent(
    request,
    response,
    { viewer, read, unread, notifications, next },
    { html: renderNotificationsPage, markdown: notificationsMarkdown },
  )
})

// Mark all notifications as read, or with `id` just that one. Forms go back to the page;
// JSON callers get `{ unread }`, the unread count after (at most 100).
notificationsRouter.post(
  '/api/notifications/read',
  requireAuth,
  rateLimit('notifications', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const rawId: unknown = request.body?.id
    const id =
      rawId === undefined || rawId === ''
        ? null
        : /^\d{1,15}$/.test(String(rawId))
          ? Number(rawId)
          : NaN
    if (Number.isNaN(id)) {
      sendError(request, response, 400, 'Invalid notification id', 'id')
      return
    }
    const unread = await markNotificationsRead(viewer.id, id)
    if (unread === undefined) {
      sendError(request, response, 404, 'Notification not found')
      return
    }
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/notifications/`,
      data: { unread },
    })
  },
)

// A checkbox sends its value when ticked and nothing when not, so a field left out is off
// (like the profile form, where left out means cleared). JSON callers may send booleans.
function isOn(value: unknown): boolean {
  return value === true || value === 'on' || value === 'true' || value === '1'
}

// The form on the profile edit page, `/:username/edit#notifications`: one checkbox per
// kind. JSON callers get `{ followedBlurts, replies, reblurts }` as saved.
notificationsRouter.post(
  '/api/notifications/settings',
  requireAuth,
  rateLimit('notifications', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const body = request.body ?? {}
    const settings: NotificationSettings = {
      followedBlurts: isOn(body.followedBlurts),
      replies: isOn(body.replies),
      reblurts: isOn(body.reblurts),
    }
    if (!(await setNotificationSettings(viewer.id, settings))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#notifications`,
      data: settings,
    })
  },
)
