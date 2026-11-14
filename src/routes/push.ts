import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { createHash } from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { getSessionId, getViewer, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { fieldErrors, sendError, sendFormErrors, sendFormSuccess } from '../negotiate.ts'
import { isPushEndpoint } from '../push.ts'
import { themeColor, defaultTheme } from '../shared/themes.ts'
import { notificationsPath } from '../ui/urls.ts'
import {
  deleteAllPushSubscriptions,
  deletePushSubscription,
  savePushSubscription,
} from './state/push.ts'

export const pushRouter = Router()
// Mounted before cookies and auth (src/server.ts): the same for everyone, and a browser
// checking its service worker for updates mustn't rotate anyone's tokens.
export const appFilesRouter = Router()

// --- Subscriptions -------------------------------------------------------------------

// A browser's PushSubscription as PushSubscription.toJSON() gives it, or the same as
// form fields (endpoint, p256dh, auth). The keys are base64url; p256dh is a P-256 point
// (65 bytes, 87 characters), auth 16 bytes (22 characters).
const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint, 'Not a push service this site sends to'),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}={0,2}$/, 'Invalid p256dh key'),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}={0,2}$/, 'Invalid auth key'),
})

function subscriptionFields(body: Record<string, unknown>) {
  const keys = (body.keys ?? {}) as Record<string, unknown>
  return {
    endpoint: body.endpoint,
    p256dh: body.p256dh ?? keys.p256dh,
    auth: body.auth ?? keys.auth,
  }
}

// "Notify me on this device" (src/client/push.ts), after the browser subscribed. Saved
// for this user and login: logging out ends it. JSON callers get `{ subscribed: true }`.
pushRouter.post(
  '/api/push/subscriptions',
  requireAuth,
  rateLimit('push', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const result = subscriptionSchema.safeParse(subscriptionFields(request.body ?? {}))
    if (!result.success) {
      await sendFormErrors(request, response, fieldErrors(result.error), (message) => message)
      return
    }
    const sessionId = getSessionId(request)
    if (!sessionId || !(await savePushSubscription(viewer.id, sessionId, result.data))) {
      sendError(request, response, 401, 'Authentication required')
      return
    }
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#notifications`,
      data: { subscribed: true },
      status: 201,
    })
  },
)

// Stops pushes to one device (`endpoint`, "Stop notifying this device"), or without it to
// all of the user's devices (a plain form on the edit page, which works without
// JavaScript). JSON callers get `{ subscribed: false }`.
pushRouter.post(
  '/api/push/subscriptions/delete',
  requireAuth,
  rateLimit('push', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const endpoint: unknown = request.body?.endpoint
    if (endpoint === undefined || endpoint === '') {
      await deleteAllPushSubscriptions(viewer.id)
    } else if (typeof endpoint === 'string' && endpoint.length <= 1000) {
      await deletePushSubscription(viewer.id, endpoint)
    } else {
      sendError(request, response, 400, 'Invalid endpoint', 'endpoint')
      return
    }
    sendFormSuccess(request, response, {
      redirect: `/${viewer.username}/edit#notifications`,
      data: { subscribed: false },
    })
  },
)

// /notifications/: the logged-in user's notifications, wherever they are. The service
// worker doesn't know whose browser it is in, so it asks for this, with the browser's
// cookies, and follows the redirect. Logged out: the login page.
pushRouter.get('/notifications/', (request, response) => {
  const viewer = getViewer(request)
  const query = new URL(request.originalUrl, 'http://x').search
  response.vary('Cookie')
  response.redirect(303, viewer ? `${notificationsPath(viewer.username)}${query}` : '/login')
})

// --- The service worker and the web app manifest -----------------------------------

// The service worker (src/client/sw.ts), with its types stripped, at /sw.js: a worker
// controls the paths under the directory of its script, and its pushes are for the whole
// site, so it has to be at the root (Service-Worker-Allowed isn't needed there). The
// browser checks it for changes at least every 24 hours and on registration, bypassing
// its HTTP cache (updateViaCache 'none' in src/client/push.ts), and a new version takes
// over at once (skipWaiting in the worker). It runs under the policy sent with it: it
// may only fetch from us.
const serviceWorker = stripTypeScriptTypes(
  readFileSync(join(import.meta.dirname, '..', 'client', 'sw.ts'), 'utf8'),
  { mode: 'strip' },
)
const serviceWorkerEtag = `"${createHash('sha256').update(serviceWorker).digest('base64url').slice(0, 27)}"`
export const serviceWorkerContentSecurityPolicy = "default-src 'none'; connect-src 'self'"

appFilesRouter.get('/sw.js', (_request, response) => {
  response.set({
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-cache',
    ETag: serviceWorkerEtag,
    'Content-Security-Policy': serviceWorkerContentSecurityPolicy,
  })
  response.send(serviceWorker)
})

// The web app manifest, for "Add to Home Screen" (which is how iPhones and iPads get
// push notifications at all: Safari only offers push to a site opened from the Home
// Screen). Linked from every page (src/pages/shared/layout.ts). No offline support: the
// site needs the network anyway, and the service worker caches nothing.
export const manifest = {
  name: 'blurt.trade',
  short_name: 'blurt',
  description: 'Say the thing. Regret it later.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: themeColor(defaultTheme),
  theme_color: themeColor(defaultTheme),
  icons: [
    { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    {
      src: '/static/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
    { src: '/static/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
}
const manifestJson = JSON.stringify(manifest)

appFilesRouter.get('/manifest.webmanifest', (_request: Request, response: Response) => {
  response.type('application/manifest+json').set('Cache-Control', 'no-cache').send(manifestJson)
})
