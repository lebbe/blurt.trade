import { Router, type Request } from 'express'
import { z } from 'zod'
import { clearSessionCookies, getViewer, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { embedPendingBlurts } from '../embeddings.ts'
import {
  fieldErrors,
  represent,
  sendError,
  sendFormErrors,
  sendFormSuccess,
  wantsJson,
} from '../negotiate.ts'
import { getFeedData } from './home.ts'
import {
  addBlurt,
  getBlurt,
  listRelatedBlurts,
  listReplies,
  parseCursor,
  type Blurt,
  type Cursor,
} from './state.ts'
import {
  blurtUrl,
  renderBlurtPage,
  renderFeedPage,
  type BlurtPageData,
} from '../templates/index.ts'
import { blurtPageMarkdown } from '../templates/pages.md.ts'

export const blurtsRouter = Router()

const blurtSchema = z.object({
  text: z.string().trim().min(1, 'Blurt is required').max(280, 'Blurt is too long'),
})

// From a URL segment, a form field (string) or a JSON body (number).
function parseBlurtId(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && /^\d{1,15}$/.test(text) ? Number(text) : undefined
}

async function getBlurtPageData(
  request: Request,
  blurt: Blurt,
  after: Cursor | null = null,
): Promise<BlurtPageData> {
  const [parent, { items: replies, next }, related] = await Promise.all([
    blurt.parentId === null ? null : getBlurt(blurt.parentId).then((parent) => parent ?? null),
    listReplies(blurt.id, after),
    listRelatedBlurts(blurt.id),
  ])
  return { viewer: getViewer(request), blurt, parent, replies, next, related }
}

blurtsRouter.get('/:username/:id', async (request, response, next) => {
  const { username, id } = request.params
  const blurtId = parseBlurtId(id)
  const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
  if (!blurt || blurt.username.toLowerCase() !== username.toLowerCase()) {
    next() // not a blurt URL (e.g. /:username/edit), or no such blurt
    return
  }
  const after = parseCursor(request.query.after)
  if (after === undefined) {
    sendError(request, response, 400, 'Invalid cursor')
    return
  }
  represent(request, response, await getBlurtPageData(request, blurt, after), {
    html: renderBlurtPage,
    markdown: blurtPageMarkdown,
  })
})

// A top-level blurt, or a reply when the body has parentId.
blurtsRouter.post(
  '/api/blurts',
  requireAuth,
  rateLimit('blurt', accountKey),
  async (request, response) => {
    let parent: Blurt | undefined
    if (request.body?.parentId !== undefined) {
      const parentId = parseBlurtId(request.body.parentId)
      parent = parentId === undefined ? undefined : await getBlurt(parentId)
      if (!parent) {
        sendError(request, response, 404, 'Blurt not found')
        return
      }
    }

    const result = blurtSchema.safeParse(request.body ?? {})

    if (!result.success) {
      await sendFormErrors(request, response, fieldErrors(result.error), async (message) => {
        const composer = {
          text: typeof request.body?.text === 'string' ? request.body.text : '',
          validationError: message,
        }
        return parent
          ? renderBlurtPage(await getBlurtPageData(request, parent), composer)
          : renderFeedPage(await getFeedData(request), composer)
      })
      return
    }

    const id = await addBlurt(response.locals.authenticatedUser.id, result.data.text, parent?.id)
    const blurt = id === undefined ? undefined : await getBlurt(id)
    if (!blurt) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      if (wantsJson(request)) {
        sendError(request, response, 401, 'Authentication required')
      } else {
        response.redirect(303, '/')
      }
      return
    }

    void embedPendingBlurts()
    // Forms go back to the page they were posted from; JSON callers get the new blurt.
    sendFormSuccess(request, response, {
      redirect: parent ? blurtUrl(parent) : '/',
      data: blurt,
      status: 201,
      location: blurtUrl(blurt),
    })
  },
)
