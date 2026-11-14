import { Router } from 'express'
import { getAccessTokenExpiry, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { sendError } from '../negotiate.ts'
import { maxStreamsPerUser, openEventStream } from '../events.ts'

export const eventsRouter = Router()

// The live-update stream of a logged-in user's tab (src/events.ts; read by
// src/client/live.ts with EventSource). Without JavaScript nothing asks for it. A stream
// ends when the access token it was opened with runs out, so it never outlives the login
// by more than the token does; the browser then reconnects and refreshes on the way.
eventsRouter.get(
  '/api/events',
  requireAuth,
  rateLimit('events', accountKey),
  (request, response) => {
    const viewer = response.locals.authenticatedUser
    // requireAuth has let only authenticated requests through, so the expiry is there.
    const expiresAt = getAccessTokenExpiry(request) ?? Date.now()
    if (!openEventStream(viewer.id, response, expiresAt)) {
      sendError(
        request,
        response,
        429,
        `Too many open tabs (at most ${maxStreamsPerUser} get live updates)`,
      )
    }
  },
)
