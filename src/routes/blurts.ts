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
  addReport,
  deleteBlurts,
  getBlurt,
  hasReported,
  isAdmin,
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
export function parseBlurtId(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && /^\d{1,15}$/.test(text) ? Number(text) : undefined
}

async function getBlurtPageData(
  request: Request,
  blurt: Blurt,
  after: Cursor | null = null,
): Promise<BlurtPageData> {
  const viewer = getViewer(request)
  const [parent, reported, { items: replies, next }, related] = await Promise.all([
    blurt.parentId === null ? null : getBlurt(blurt.parentId).then((parent) => parent ?? null),
    viewer ? hasReported(viewer.id, blurt.id) : false,
    listReplies(blurt.id, after),
    listRelatedBlurts(blurt.id),
  ])
  return { viewer, blurt, parent, reported, replies, next, related }
}

// A deleted placeholder answers under any username: it has no author any more, and old
// links still carry the author's name.
blurtsRouter.get('/:username/:id', async (request, response, next) => {
  const { username, id } = request.params
  const blurtId = parseBlurtId(id)
  const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
  if (!blurt || (!blurt.deleted && blurt.username?.toLowerCase() !== username.toLowerCase())) {
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
      if (!parent || parent.deleted) {
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

// Where a form goes back to after deleting: the page it was posted from (Referer, same
// host only), unless that was the deleted blurt's own page. Then the thread it replied
// to, or the feed.
async function afterDelete(request: Request, blurt: Blurt): Promise<string> {
  const referer = URL.parse(request.get('referer') ?? '')
  // /:username/:id, the blurt's own page, is gone or a placeholder now. A path starting
  // with // would be another site to the browser.
  const ownPage = referer?.pathname.split('/')[2] === String(blurt.id)
  const local = referer?.host === request.get('host') && !referer?.pathname.startsWith('//')
  if (referer && local && !ownPage) {
    return referer.pathname + referer.search
  }
  const parent = blurt.parentId === null ? undefined : await getBlurt(blurt.parentId)
  return parent ? blurtUrl(parent) : '/'
}

// The author deletes their own blurt; an admin deletes anyone's (from /admin/reports).
// Replies by others keep it as a placeholder (see deleteBlurts).
blurtsRouter.post(
  '/api/blurts/:id/delete',
  requireAuth,
  rateLimit('deleteBlurt', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const blurtId = parseBlurtId(request.params.id)
    const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
    if (!blurt || blurt.deleted) {
      sendError(request, response, 404, 'Blurt not found')
      return
    }
    if (blurt.username !== viewer.username && !(await isAdmin(viewer.id))) {
      sendError(request, response, 403, 'Forbidden')
      return
    }

    await deleteBlurts([blurt.id])
    sendFormSuccess(request, response, { redirect: await afterDelete(request, blurt) })
  },
)

const reportSchema = z.object({
  reason: z.string().trim().max(500, 'Reason is too long').default(''),
})

// One report per user and blurt; reporting again does nothing. Forms go to the blurt's
// page, which says it was reported.
blurtsRouter.post(
  '/api/report',
  requireAuth,
  rateLimit('report', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const blurtId = parseBlurtId(request.body?.blurtId)
    const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
    if (!blurt || blurt.deleted) {
      sendError(request, response, 404, 'Blurt not found')
      return
    }
    if (blurt.username === viewer.username) {
      sendError(request, response, 400, "You can't report your own blurt")
      return
    }

    const result = reportSchema.safeParse(request.body ?? {})
    if (!result.success) {
      await sendFormErrors(request, response, fieldErrors(result.error), async (message) =>
        renderBlurtPage(await getBlurtPageData(request, blurt), undefined, message),
      )
      return
    }

    if (!(await addReport(viewer.id, blurt.id, result.data.reason))) {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      sendError(request, response, 401, 'Authentication required')
      return
    }
    sendFormSuccess(request, response, { redirect: blurtUrl(blurt) })
  },
)
