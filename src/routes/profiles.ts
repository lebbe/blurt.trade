import { Router } from 'express'
import { z } from 'zod'
import { getAuthenticatedUser, readAccessToken, requireAuth } from '../middleware/auth.ts'
import { getUserProfileByUsername, listBlurtsByUserId, updateUserProfile } from './state.ts'
import { isWebUrl, renderProfileEditPage, renderProfilePage } from '../templates/index.ts'

export const profilesRouter = Router()

const socialValue = z
  .string()
  .trim()
  .max(200, 'Social fields must be at most 200 characters')
  .refine(
    (value) => value === '' || isWebUrl(value) || /^@?[A-Za-z0-9._-]{1,100}$/.test(value),
    'Social fields must be a username/handle or a full http(s) URL',
  )
  .default('')

// Missing fields count as empty, so a partial POST gets a readable error, not a type error.
export const profileSchema = z.object({
  homepage: z
    .string()
    .trim()
    .max(200, 'Homepage must be at most 200 characters')
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
  bio: z.string().trim().max(4000, 'Bio must be at most 4000 characters').default(''),
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
  const { username } = request.params
  const profile = await getUserProfileByUsername(username)

  if (!profile) {
    response.status(404).send('User not found')
    return
  }

  const viewer = await getAuthenticatedUser(readAccessToken(request.headers.cookie))
  const userBlurts = await listBlurtsByUserId(profile.userId)

  response.type('html').send(
    renderProfilePage({
      blurts: userBlurts,
      profile,
      canEdit: viewer?.id === profile.userId,
    }),
  )
})

profilesRouter.get('/:username/edit', requireAuth, async (request, response) => {
  const { username } = request.params
  const authenticatedUser = response.locals.authenticatedUser
  const profile = await getUserProfileByUsername(username)

  if (!profile) {
    response.status(404).send('User not found')
    return
  }

  if (authenticatedUser.id !== profile.userId) {
    response.status(403).send('Forbidden')
    return
  }

  response.type('html').send(renderProfileEditPage({ profile }))
})

profilesRouter.post('/:username/edit', requireAuth, async (request, response) => {
  const authenticatedUser = response.locals.authenticatedUser
  const profile = await getUserProfileByUsername(request.params.username)

  if (!profile) {
    response.status(404).send('User not found')
    return
  }

  if (authenticatedUser.id !== profile.userId) {
    response.status(403).send('Forbidden')
    return
  }

  const result = profileSchema.safeParse(request.body)
  if (!result.success) {
    response
      .status(400)
      .type('html')
      .send(
        renderProfileEditPage({
          profile: { ...profile, ...submittedFields(request.body) },
          validationError: result.error.issues.map((issue) => issue.message).join(' '),
        }),
      )
    return
  }

  await updateUserProfile(profile.userId, result.data)
  response.redirect(303, `/${profile.username}/`)
})
