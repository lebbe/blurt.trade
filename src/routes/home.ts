import { Router, type Request } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { represent, sendError } from '../negotiate.ts'
import { listFeed, parseCursor, type Cursor } from './state.ts'
import { renderFeedPage, type FeedData } from '../templates/index.ts'
import { feedMarkdown } from '../templates/pages.md.ts'

export const homeRouter = Router()

export async function getFeedData(
  request: Request,
  before: Cursor | null = null,
): Promise<FeedData> {
  const [viewer, { items: blurts, next }] = await Promise.all([
    getViewer(request),
    listFeed(before),
  ])
  return { viewer, blurts, next }
}

homeRouter.get('/', async (request, response) => {
  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor')
    return
  }
  represent(request, response, await getFeedData(request, before), {
    html: renderFeedPage,
    markdown: feedMarkdown,
  })
})
