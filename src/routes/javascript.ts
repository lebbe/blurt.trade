import { Router } from 'express'
import { clearSessionCookies, getViewer, setSessionJavaScript } from '../middleware/auth.ts'
import { rateLimit } from '../middleware/rate-limit.ts'
import { sendError, sendFormSuccess, wantsJson } from '../negotiate.ts'
import { setJavaScriptCookie } from '../javascript.ts'
import { javascriptSettingPath } from '../ui/urls.ts'
import { setJavaScript } from './state/profiles.ts'

export const javascriptRouter = Router()

// "Use JavaScript" (src/javascript.ts): a plain form POST from /settings or /about, so it
// works with JavaScript off, which is when it matters most. `javascript` is `on` or `off`
// (JSON: true or false too). It sets this browser's cookie and, logged in, saves the
// setting on the account and reissues the access token, so the page it goes back to
// already has (or lacks) the scripts. JSON callers get `{ javascript }`.
javascriptRouter.post('/api/javascript', rateLimit('javascript'), async (request, response) => {
  const value: unknown = request.body?.javascript
  const on =
    value === 'on' || value === true ? true : value === 'off' || value === false ? false : undefined
  if (on === undefined) {
    sendError(request, response, 400, 'Send javascript as on or off', 'javascript')
    return
  }
  const viewer = getViewer(request)
  if (viewer) {
    if (!(await setJavaScript(viewer.id, on))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }
    await setSessionJavaScript(request, response, on)
  }
  setJavaScriptCookie(response, on)
  sendFormSuccess(request, response, {
    redirect: javascriptSettingPath(viewer !== null),
    data: { javascript: on },
  })
})
