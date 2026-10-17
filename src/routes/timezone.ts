import { Router } from 'express'
import { clearSessionCookies, requireAuth, setSessionTime } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import { isLocale, isTimeZone } from '../timezones.ts'
import { setTimeSettings } from './state.ts'

export const timeZoneRouter = Router()

// The time picker on the profile edit page, a plain form POST like the theme's: `timezone`
// (an IANA name) and `locale` (one of src/timezones.ts, or empty to follow the browser's
// language). Either can be left out to keep it. Saved on the account and carried in the
// access token, which is reissued here. JSON callers get `{ timezone, locale }` as saved.
timeZoneRouter.post(
  '/api/timezone',
  requireAuth,
  rateLimit('timezone', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const timezone: unknown = request.body?.timezone
    const locale: unknown = request.body?.locale
    if (timezone !== undefined && !isTimeZone(timezone)) {
      sendError(request, response, 400, 'Unknown time zone', 'timezone')
      return
    }
    if (locale !== undefined && locale !== '' && locale !== null && !isLocale(locale)) {
      sendError(request, response, 400, 'Unknown language', 'locale')
      return
    }
    if (timezone === undefined && locale === undefined) {
      sendError(request, response, 400, 'Send a timezone or a locale', 'timezone')
      return
    }
    const changes = {
      ...(timezone !== undefined && { timeZone: timezone as string }),
      ...(locale !== undefined && {
        locale: locale === '' || locale === null ? null : (locale as string),
      }),
    }
    if (!(await setTimeSettings(viewer.id, changes))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }
    await setSessionTime(request, response, changes)
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#timezone`,
      data: {
        ...(timezone !== undefined && { timezone }),
        ...(locale !== undefined && { locale: changes.locale }),
      },
    })
  },
)
