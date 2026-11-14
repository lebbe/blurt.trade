import { Router } from 'express'
import { clearSessionCookies, requireAuth, setSessionTime } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import { pageContext } from '../page-context.ts'
import { isLocale, isTimeZone, localeFrom } from '../timezones.ts'
import { setTimeSettings } from './state.ts'

export const timeZoneRouter = Router()

// The time picker on the profile edit page, a plain form POST like the theme's: `timezone`
// (an IANA name) and `locale` (one of src/timezones.ts, or empty to follow the browser's
// language). Either can be left out to keep it. Saved on the account and carried in the
// access token, which is reissued here. JSON callers get `{ timezone, locale }` as saved
// (each only when sent), and `display: { timeZone, locale }`, how pages show times from
// now on: the locale is the browser's (Accept-Language) when none is picked. The edit
// page's script rewrites the page's times with it (src/client/times.ts).
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
    const before = pageContext()
    const display = {
      timeZone: changes.timeZone ?? before.timeZone,
      locale:
        changes.locale === undefined
          ? before.locale
          : (changes.locale ?? localeFrom(request.acceptsLanguages())),
    }
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#timezone`,
      data: {
        ...(timezone !== undefined && { timezone }),
        ...(locale !== undefined && { locale: changes.locale }),
        display,
      },
    })
  },
)
