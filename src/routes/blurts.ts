import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  clearAccessToken,
  getAuthenticatedUser,
  readAccessToken,
  requireAuth,
} from '../middleware/auth.ts'
import { embedPendingBlurts } from '../embeddings.ts'
import {
  addBlurt,
  getBlurt,
  listFeed,
  listRelatedBlurts,
  listReplies,
  type Blurt,
} from './state.ts'
import { renderBlurtPage, renderFeedPage } from '../templates/index.ts'

export const blurtsRouter = Router()

const blurtSchema = z.object({
  text: z.string().trim().min(1, 'Blurt is required').max(280, 'Blurt is too long'),
})

function parseBlurtId(value: unknown): number | undefined {
  return typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : undefined
}

type Composer = { text: string; validationError: string }

async function sendBlurtPage(
  request: Request,
  response: Response,
  blurt: Blurt,
  composer?: Composer,
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
  const { username, id } = request.params
  const blurtId = parseBlurtId(id)
  const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
  if (!blurt || blurt.username.toLowerCase() !== username.toLowerCase()) {
    next() // not a blurt URL (e.g. /:username/edit), or no such blurt
    return
  }
  await sendBlurtPage(request, response, blurt)
})

// A top-level blurt, or a reply when the form sends parentId.
blurtsRouter.post('/api/blurts', requireAuth, async (request, response) => {
  let parent: Blurt | undefined
  if (request.body?.parentId !== undefined) {
    const parentId = parseBlurtId(request.body.parentId)
    parent = parentId === undefined ? undefined : await getBlurt(parentId)
    if (!parent) {
      response.status(404).send('Blurt not found')
      return
    }
  }

  const result = blurtSchema.safeParse(request.body)

  if (!result.success) {
    const composer = {
      text: typeof request.body?.text === 'string' ? request.body.text : '',
      validationError: result.error.issues.map((issue) => issue.message).join(' '),
    }
    if (parent) {
      await sendBlurtPage(request, response, parent, composer)
    } else {
      response
        .status(400)
        .type('html')
        .send(renderFeedPage(await listFeed(), composer, true))
    }
    return
  }

  const id = await addBlurt(response.locals.authenticatedUser.id, result.data.text, parent?.id)
  if (id === undefined) {
    // A still-valid token for a user that no longer exists (e.g. after a database reset).
    clearAccessToken(response)
    response.redirect(303, '/')
    return
  }

  void embedPendingBlurts()
  response.redirect(303, parent ? `/${parent.username}/${parent.id}` : '/')
})
