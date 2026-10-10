import { Router, type Request, type Response } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { represent, sendError } from '../negotiate.ts'
import {
  countFollowing,
  followingFeedThreshold,
  listFeed,
  listFollowedHighlights,
  parseCursor,
  type Cursor,
} from './state.ts'
import { renderFeedPage, type FeedData } from '../templates/index.ts'
import { feedMarkdown } from '../templates/pages.md.ts'

export const homeRouter = Router()

// `/` is the following feed for viewers who follow more than `followingFeedThreshold`
// accounts. Everyone else gets the everyone feed there, with the latest blurts from the
// accounts they do follow on top of the first page. `/everyone` is always everyone.
export async function getFeedData(
  request: Request,
  before: Cursor | null = null,
  path: '/' | '/everyone' = '/',
): Promise<FeedData> {
  const viewer = await getViewer(request)
  const followingCount = viewer ? await countFollowing(viewer.id) : 0
  const hasFollowingFeed = followingCount > followingFeedThreshold
  const feed = path === '/' && hasFollowingFeed ? 'following' : 'everyone'
  const [{ items: blurts, next }, followedBlurts] = await Promise.all([
    listFeed(before, viewer && feed === 'following' ? viewer.id : null),
    viewer && !hasFollowingFeed && followingCount > 0 && before === null
      ? listFollowedHighlights(viewer.id)
      : [],
  ])
  return { viewer, feed, hasFollowingFeed, followedBlurts, blurts, next }
}

async function sendFeed(request: Request, response: Response, path: '/' | '/everyone') {
  const before = parseCursor(request.query.before)
  if (before === undefined) {
    sendError(request, response, 400, 'Invalid cursor')
    return
  }
  represent(request, response, await getFeedData(request, before, path), {
    html: renderFeedPage,
    markdown: feedMarkdown,
  })
}

homeRouter.get('/', (request, response) => sendFeed(request, response, '/'))
homeRouter.get('/everyone', (request, response) => sendFeed(request, response, '/everyone'))
