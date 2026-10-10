import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { getAuthenticatedUser, readAccessToken, requireAuth } from '../middleware/auth.ts'
import { validate } from '../middleware/validate.ts'
import { embedPendingBlurts } from '../embeddings.ts'
import { addBlurt, getBlurt, listRelatedBlurts, listReplies, type Blurt } from './state.ts'
import { renderBlurtPage } from '../templates/index.ts'

export const blurtsRouter = Router()

const blurtSchema = z.object({
  text: z.string().trim().min(1, 'Blurt is required').max(280, 'Blurt is too long'),
})

blurtsRouter.post('/blurts', requireAuth, validate(blurtSchema), async (request, response) => {
  const { text } = request.body as z.infer<typeof blurtSchema>
  const id = await addBlurt(response.locals.authenticatedUser.id, text)
  if (id !== undefined) {
    void embedPendingBlurts()
  }
  response.redirect(303, id === undefined ? '/logout' : '/')
})

// The blurt at /:username/:id, or undefined if the id isn't numeric or doesn't belong to username.
async function findBlurt(request: Request): Promise<Blurt | undefined> {
  const { username, id } = request.params
  if (typeof id !== 'string' || !/^\d{1,15}$/.test(id)) {
    return undefined
  }
  const blurt = await getBlurt(Number(id))
  return blurt?.username === username ? blurt : undefined
}

async function sendBlurtPage(
  request: Request,
  response: Response,
  blurt: Blurt,
  composer?: { text: string; validationError: string },
): Promise<void> {
  const [parent, replies, related, viewer] = await Promise.all([
    blurt.parentId === null ? undefined : getBlurt(blurt.parentId),
    listReplies(blurt.id),
    listRelatedBlurts(blurt.id),
    getAuthenticatedUser(readAccessToken(request.headers.cookie)),
  ])
  response
    .status(composer ? 400 : 200)
    .type('html')
    .send(
      renderBlurtPage({
        blurt,
        parent,
        replies,
        related,
        composer,
        isAuthenticated: Boolean(viewer),
      }),
    )
}

blurtsRouter.get('/:username/:id', async (request, response, next) => {
  const blurt = await findBlurt(request)
  if (!blurt) {
    next() // not a blurt URL (e.g. /:username/edit), or no such blurt
    return
  }
  await sendBlurtPage(request, response, blurt)
})

blurtsRouter.post('/:username/:id/replies', requireAuth, async (request, response) => {
  const blurt = await findBlurt(request)
  if (!blurt) {
    response.status(404).send('Blurt not found')
    return
  }

  const result = blurtSchema.safeParse(request.body)
  if (!result.success) {
    const text = typeof request.body?.text === 'string' ? request.body.text : ''
    const validationError = result.error.issues.map((issue) => issue.message).join(' ')
    await sendBlurtPage(request, response, blurt, { text, validationError })
    return
  }

  const id = await addBlurt(response.locals.authenticatedUser.id, result.data.text, blurt.id)
  if (id === undefined) {
    response.redirect(303, '/logout')
    return
  }
  void embedPendingBlurts()
  response.redirect(303, `/${blurt.username}/${blurt.id}`)
})
