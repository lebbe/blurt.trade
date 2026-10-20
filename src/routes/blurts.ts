import { Router, type Request, type RequestHandler } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { clearSessionCookies, getViewer, requireAuth } from '../middleware/auth.ts'
import { accountKey, rateLimit } from '../middleware/rate-limit.ts'
import { embedPendingBlurts } from '../embeddings.ts'
import {
  blurtMaxLength,
  blurtMaxNewlines,
  pictureMaxStoredBytes,
  pictureMaxUploadBytes,
  reportReasonMaxLength,
  text,
} from '../limits.ts'
import { drawPicture, PictureBusyError, PictureTimeoutError } from '../picture-pool.ts'
import {
  fieldErrors,
  type FieldError,
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
  getCardColor,
  hasReported,
  isAdmin,
  listRelatedBlurts,
  listReplies,
  markViewerFlags,
  parseCursor,
  setLike,
  setReblurt,
  type Blurt,
  type Cursor,
} from './state.ts'
import {
  blurtAnchor,
  blurtUrl,
  renderBlurtPage,
  renderFeedPage,
  type BlurtPageData,
} from '../templates/index.ts'
import { blurtPageMarkdown } from '../templates/pages.md.ts'

export const blurtsRouter = Router()

const blurtSchema = z.object({
  text: text(blurtMaxLength, `Blurt must be at most ${blurtMaxLength} characters`)
    .min(1, 'Blurt is required')
    .refine(
      (value) => (value.match(/\n/g) ?? []).length <= blurtMaxNewlines,
      `Blurt can have at most ${blurtMaxNewlines} newlines`,
    ),
})

// The optional picture of a blurt: held in memory, never written to disk (see src/picture.ts).
const pictureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: pictureMaxUploadBytes, files: 1 },
}).single('picture')

const uploadPicture: RequestHandler = (request, response, next) => {
  pictureUpload(request, response, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        sendError(request, response, 413, 'Picture is too large')
      } else {
        sendError(request, response, 400, error.message, 'picture')
      }
    } else {
      next(error)
    }
  })
}

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
  const [parent, reported, { items: replies, next }, related, cardColor] = await Promise.all([
    blurt.parentId === null ? null : getBlurt(blurt.parentId).then((parent) => parent ?? null),
    viewer ? hasReported(viewer.id, blurt.id) : false,
    listReplies(blurt.id, after),
    listRelatedBlurts(blurt.id),
    blurt.username ? getCardColor(blurt.username) : null,
  ])
  await markViewerFlags(viewer?.id ?? null, [blurt, parent, ...replies, ...related])
  return { viewer, blurt, parent, reported, replies, next, related, cardColor }
}

// A deleted placeholder answers under any username: it has no author any more, and old
// links still carry the author's name.
blurtsRouter.get('/:username/:id', async (request, response, next) => {
  const { username, id } = request.params
  const blurtId = parseBlurtId(id)
  const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
  // A plain reblurt has no page of its own: getBlurt would give its original.
  const wrongUrl =
    !blurt ||
    blurt.id !== blurtId ||
    (!blurt.deleted && blurt.username?.toLowerCase() !== username.toLowerCase())
  if (wrongUrl) {
    next() // not a blurt URL (e.g. /:username/edit), or no such blurt
    return
  }
  const after = parseCursor(request.query.after)
  if (after === undefined) {
    sendError(request, response, 400, 'Invalid cursor', 'after')
    return
  }
  represent(request, response, await getBlurtPageData(request, blurt, after), {
    html: renderBlurtPage,
    markdown: blurtPageMarkdown,
  })
})

// The blurt a field of the body names (parentId, reblurtOfId), as it is shown: a plain
// reblurt gives its original, so replies and quotes go there. Undefined when the field is
// missing, null when it names no blurt, or a deleted one.
async function referencedBlurt(value: unknown): Promise<Blurt | null | undefined> {
  if (value === undefined) {
    return undefined
  }
  const id = parseBlurtId(value)
  const blurt = id === undefined ? undefined : await getBlurt(id)
  return blurt && !blurt.deleted ? blurt : null
}

// A top-level blurt, a reply when the body has parentId, or a quote-reblurt when it has
// reblurtOfId: a blurt of its own, with the quoted one shown under it.
blurtsRouter.post(
  '/api/blurts',
  requireAuth,
  rateLimit('blurt', accountKey),
  uploadPicture,
  async (request, response) => {
    const parent = await referencedBlurt(request.body?.parentId)
    const quoted = await referencedBlurt(request.body?.reblurtOfId)
    if (parent === null || quoted === null) {
      sendError(request, response, 404, 'Blurt not found')
      return
    }
    if (parent && quoted) {
      sendError(request, response, 400, 'A blurt can reply or quote, not both', 'reblurtOfId')
      return
    }

    const result = blurtSchema.safeParse(request.body ?? {})
    const errors: FieldError[] = result.success ? [] : fieldErrors(result.error)

    let picture: { width: number; height: number; shapes: Buffer } | undefined
    if (result.success && request.file) {
      let drawn
      try {
        drawn = await drawPicture(request.file.buffer)
      } catch (error) {
        if (error instanceof PictureBusyError) {
          response.set('Retry-After', '5')
          sendError(
            request,
            response,
            503,
            'Too many pictures are being processed. Try again soon.',
          )
          return
        }
        if (!(error instanceof PictureTimeoutError)) {
          throw error
        }
      }
      if (!drawn) {
        errors.push({
          field: 'picture',
          message: 'Could not read the picture. Use JPEG, PNG or WebP.',
        })
      } else if (drawn.shapes.length > pictureMaxStoredBytes) {
        errors.push({ field: 'picture', message: 'The picture is too detailed' })
      } else {
        picture = drawn
      }
    }

    if (!result.success || errors.length > 0) {
      await sendFormErrors(request, response, errors, async (message) => {
        const composer = {
          text: typeof request.body?.text === 'string' ? request.body.text : '',
          validationError: message,
          reblurtOfId: quoted?.id,
        }
        const thread = parent ?? quoted
        return thread
          ? renderBlurtPage(await getBlurtPageData(request, thread), composer)
          : renderFeedPage(await getFeedData(request), composer)
      })
      return
    }

    const id = await addBlurt(response.locals.authenticatedUser.id, result.data.text, {
      parentId: parent?.id,
      reblurtOfId: quoted?.id,
      picture,
    })
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
    // Forms go back to the thread replied to, to the new quote's page, or to the feed; JSON
    // callers get the new blurt.
    sendFormSuccess(request, response, {
      redirect: parent ? blurtUrl(parent) : quoted ? blurtUrl(blurt) : '/',
      data: blurt,
      status: 201,
      location: blurtUrl(blurt),
    })
  },
)

// The page a form was posted from (its Referer), if that is on this site. A path starting
// with // would be another site to the browser.
function localReferer(request: Request): URL | undefined {
  const referer = URL.parse(request.get('referer') ?? '')
  const local = referer?.host === request.get('host') && !referer?.pathname.startsWith('//')
  return referer && local ? referer : undefined
}

// Separate POSTs for like and unlike, reblurt and unreblurt, so a plain form on any blurt
// can send each. A plain reblurt's id acts on its original. Forms go back to the page they
// came from (at the blurt), or the blurt's page without a usable Referer; JSON callers get
// the new state: `{ blurtId, likeCount, viewerLikes }` or
// `{ blurtId, reblurtCount, viewerReblurted }`.
function toggleAction<State>(
  set: (userId: number, blurtId: number) => Promise<State | 'not-found' | 'no-user' | 'own'>,
): RequestHandler {
  return async (request, response) => {
    const blurtId = parseBlurtId(request.body?.blurtId)
    const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
    const state =
      blurt && !blurt.deleted
        ? await set(response.locals.authenticatedUser.id, blurt.id)
        : 'not-found'
    if (state === 'not-found' || !blurt) {
      sendError(request, response, 404, 'Blurt not found')
      return
    }
    if (state === 'own') {
      sendError(request, response, 400, "You can't reblurt your own blurt. Quote it instead.")
      return
    }
    if (state === 'no-user') {
      // A still-valid token for a user that no longer exists (e.g. after a database reset).
      clearSessionCookies(response)
      sendError(request, response, 401, 'Authentication required')
      return
    }
    const referer = localReferer(request)
    sendFormSuccess(request, response, {
      redirect: referer
        ? `${referer.pathname}${referer.search}#${blurtAnchor(blurt)}`
        : blurtUrl(blurt),
      data: state,
    })
  }
}

blurtsRouter.post(
  '/api/like',
  requireAuth,
  rateLimit('like', accountKey),
  toggleAction((userId, blurtId) => setLike(userId, blurtId, true)),
)
blurtsRouter.post(
  '/api/unlike',
  requireAuth,
  rateLimit('like', accountKey),
  toggleAction((userId, blurtId) => setLike(userId, blurtId, false)),
)
blurtsRouter.post(
  '/api/reblurt',
  requireAuth,
  rateLimit('reblurt', accountKey),
  toggleAction((userId, blurtId) => setReblurt(userId, blurtId, true)),
)
blurtsRouter.post(
  '/api/unreblurt',
  requireAuth,
  rateLimit('reblurt', accountKey),
  toggleAction((userId, blurtId) => setReblurt(userId, blurtId, false)),
)

// Where a form goes back to after deleting: the page it was posted from (Referer, same
// host only), unless that was the deleted blurt's own page. Then the thread it replied
// to, or the feed.
async function afterDelete(request: Request, blurt: Blurt): Promise<string> {
  const referer = localReferer(request)
  // /:username/:id, the blurt's own page, is gone or a placeholder now.
  if (referer && referer.pathname.split('/')[2] !== String(blurt.id)) {
    return referer.pathname + referer.search
  }
  const parent = blurt.parentId === null ? undefined : await getBlurt(blurt.parentId)
  return parent ? blurtUrl(parent) : '/'
}

// The author deletes their own blurt; an admin deletes anyone's (from /admin/reports).
// It stays as a placeholder (see deleteBlurts). A plain reblurt is undone with
// /api/unreblurt, not deleted here.
blurtsRouter.post(
  '/api/blurts/:id/delete',
  requireAuth,
  rateLimit('deleteBlurt', accountKey),
  async (request, response) => {
    const viewer = response.locals.authenticatedUser
    const blurtId = parseBlurtId(request.params.id)
    const blurt = blurtId === undefined ? undefined : await getBlurt(blurtId)
    if (!blurt || blurt.deleted || blurt.id !== blurtId) {
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
  reason: text(reportReasonMaxLength, 'Reason is too long').default(''),
})

// One report per user and blurt; reporting again does nothing. Forms go to the blurt's
// page, which says it was reported. A plain reblurt's id reports its original.
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
