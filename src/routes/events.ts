import { Router } from 'express'
import { accessTokenLifetimeMs, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { sendError } from '../negotiate.ts'
import { maxStreamsPerUser, openEventStream } from '../events.ts'

export const eventsRouter = Router()

// The live-update stream of a logged-in user's tab (src/events.ts; read by
// src/client/live.ts with EventSource). Without JavaScript nothing asks for it. A stream
// lasts at most an access token's lifetime, so it never outlives the login it was opened
// with by more than the token does.
eventsRouter.get(
  '/api/events',
  requireAuth,
  rateLimit('events', accountKey),
  (request, response) => {
    const viewer = response.locals.authenticatedUser
    if (!openEventStream(viewer.id, response, accessTokenLifetimeMs)) {
      sendError(
        request,
        response,
        429,
        `Too many open tabs (at most ${maxStreamsPerUser} get live updates)`,
      )
    }
  },
)
