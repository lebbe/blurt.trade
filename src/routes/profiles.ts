import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { clearSessionCookies, getViewer, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import {
  fieldErrors,
  represent,
  sendError,
  sendFormErrors,
  sendFormSuccess,
  wantsJson,
} from '../negotiate.ts'
import {
  follow,
  getFollowStats,
  getLocation,
  getInvitedBy,
  getUserProfileByUsername,
  listInviteCodes,
  listBlurtsByUserId,
  parseCursor,
  unfollow,
  updateUserProfile,
} from './state.ts'
import { bioMaxLength, isWebUrl, linkMaxLength, text } from '../limits.ts'
import { renderProfileEditPage, renderProfilePage } from '../templates/index.ts'
import { profileEditMarkdown, profilePageMarkdown } from '../templates/pages.md.ts'

export const profilesRouter = Router()

const socialValue = text(linkMaxLength, `Social fields must be at most ${linkMaxLength} characters`)
  .refine(
    (value) => value === '' || isWebUrl(value) || /^@?[A-Za-z0-9._-]{1,100}$/.test(value),
    'Social fields must be a username/handle or a full http(s) URL',
  )
  .default('')

// Missing fields count as empty, so a partial POST gets a readable error, not a type error.
export const profileSchema = z.object({
  homepage: text(linkMaxLength, `Homepage must be at most ${linkMaxLength} characters`)
    .refine(
      (value) => value === '' || isWebUrl(value),
      'Homepage must be a full URL starting with https:// or http://',
    )
    .default(''),
  x: socialValue,
  instagram: socialValue,
  tiktok: socialValue,
  youtube: socialValue,
  github: socialValue,
  linkedin: socialValue,
  bio: text(bioMaxLength, `Bio must be at most ${bioMaxLength} characters`).default(''),
})

// Echo back only the form's own fields when re-rendering after a validation error.
function submittedFields(body: unknown): Partial<z.infer<typeof profileSchema>> {
  const values = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  return Object.fromEntries(
    Object.keys(profileSchema.shape)
      .filter((key) => typeof values[key] === 'string')
      .map((key) => [key, values[key]]),
  )
}

profilesRouter.get('/:username/', async (request, response) => {
  const profile = await getUserProfileByUsername(request.params.username)

  if (!profile) {
    sendError(request, response, 404, 'User not found')
    return
  }

  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'before')
    return
  }

  const viewer = getViewer(request)
  const isOwner = viewer?.id === profile.userId
  const [invitedBy, inviteCodes, follows, { items: blurts, next }] = await Promise.all([
    getInvitedBy(profile.userId),
    isOwner ? listInviteCodes(profile.userId) : null, // codes are only for their owner
    getFollowStats(profile.userId, viewer?.id ?? null),
    listBlurtsByUserId(profile.userId, before),
  ])
  represent(
    request,
    response,
    { viewer, profile, invitedBy, inviteCodes, follows, blurts, next },
    { html: renderProfilePage, markdown: profilePageMarkdown },
  )
})

profilesRouter.get('/:username/edit', requireAuth, async (request, response) => {
  const viewer = response.locals.authenticatedUser
  const profile = await getUserProfileByUsername(request.params.username)

  if (!profile) {
    sendError(request, response, 404, 'User not found')
    return
  }

  if (viewer.id !== profile.userId) {
    sendError(request, response, 403, 'Forbidden')
    return
  }

  represent(
    request,
    response,
    { viewer, profile, location: await getLocation(profile.userId) },
    { html: renderProfileEditPage, markdown: profileEditMarkdown },
  )
})

profilesRouter.post(
  '/:username/edit',
  requireAuth,
  rateLimit('profileEdit', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const profile = await getUserProfileByUsername(request.params.username)

    if (!profile) {
      sendError(request, response, 404, 'User not found')
      return
    }

    if (viewer.id !== profile.userId) {
      sendError(request, response, 403, 'Forbidden')
      return
    }

    const result = profileSchema.safeParse(request.body ?? {})
    if (!result.success) {
      const location = await getLocation(profile.userId)
      await sendFormErrors(request, response, fieldErrors(result.error), (validationError) =>
        renderProfileEditPage({
          viewer,
          profile: { ...profile, ...submittedFields(request.body) },
          location,
          validationError,
        }),
      )
      return
    }

    const updated = await updateUserProfile(profile.userId, result.data)
    sendFormSuccess(request, response, { redirect: `/${profile.username}/`, data: updated })
  },
)

// Separate POSTs for follow and unfollow, so a plain form on the profile can send either.
// Forms go back to the profile; JSON callers get its updated follow stats.
function followAction(action: 'follow' | 'unfollow'): RequestHandler {
  return async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const username: unknown = request.body?.username
    const profile =
      typeof username === 'string' ? await getUserProfileByUsername(username) : undefined

    if (!profile) {
      sendError(request, response, 404, 'User not found')
      return
    }

    if (action === 'unfollow') {
      await unfollow(viewer.id, profile.userId)
    } else if (profile.userId === viewer.id) {
      sendError(request, response, 400, "You can't follow yourself")
      return
    } else if (!(await follow(viewer.id, profile.userId))) {
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
      redirect: `/${profile.username}/`,
      data: await getFollowStats(profile.userId, viewer.id),
    })
  }
}

profilesRouter.post(
  '/api/follow',
  requireAuth,
  rateLimit('follow', accountKey),
  followAction('follow'),
)
profilesRouter.post(
  '/api/unfollow',
  requireAuth,
  rateLimit('follow', accountKey),
  followAction('unfollow'),
)
