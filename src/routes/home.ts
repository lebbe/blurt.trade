import { Router, type Request, type Response } from 'express'
import { getViewer } from '../middleware/auth.ts'
import { represent, sendError } from '../negotiate.ts'
import {
  countFollowing,
  followingFeedThreshold,
  listFeed,
  listFollowedHighlights,
  listNearbyForUser,
  listSimilarToUser,
  parseCursor,
  type Blurt,
  type Cursor,
  type FeedItem,
} from './state.ts'
import {
  renderFeedPage,
  type DiscoveryKind,
  type DiscoverySection,
  type FeedData,
} from '../templates/index.ts'
import { feedMarkdown } from '../templates/pages.md.ts'

export const homeRouter = Router()

// `/` is the following feed for viewers who follow more than `followingFeedThreshold`
// accounts. Everyone else gets the everyone feed there, with the latest blurts from the
// accounts they do follow on top of the first page. `/everyone` is always everyone.
// Logged-in viewers get discovery sections mixed into the first page of either feed.
export async function getFeedData(
  request: Request,
  before: Cursor | null = null,
  path: '/' | '/everyone' = '/',
): Promise<FeedData> {
  const viewer = getViewer(request)
  const followingCount = viewer ? await countFollowing(viewer.id) : 0
  const hasFollowingFeed = followingCount > followingFeedThreshold
  const feed = path === '/' && hasFollowingFeed ? 'following' : 'everyone'
  const [{ items: blurts, next }, followedBlurts] = await Promise.all([
    listFeed(before, viewer && feed === 'following' ? viewer.id : null),
    viewer && !hasFollowingFeed && followingCount > 0 && before === null
      ? listFollowedHighlights(viewer.id)
      : [],
  ])
  const discovery =
    viewer && before === null ? await getDiscovery(viewer.id, followedBlurts, blurts) : []
  return { viewer, feed, hasFollowingFeed, followedBlurts, blurts, discovery, next }
}

// One section after every `discoveryInterval` blurts on the page (one at the end of a
// shorter page), each with up to `discoverySectionSize` blurts.
const discoveryInterval = 20
const discoverySectionSize = 3

// Where each kind of discovery section gets its blurts: a query against the same blurts
// table as the feed, leaving out the viewer's own, followed accounts' and `excludeIds`.
// 'nearby' finds nothing for viewers without a location. A new kind is one more entry here.
const discoverySources: Record<
  DiscoveryKind,
  (viewerId: number, excludeIds: number[], limit: number) => Promise<Blurt[]>
> = {
  similar: listSimilarToUser,
  nearby: listNearbyForUser,
}

// Sources take turns filling the slots, so with more than one kind they alternate. A blurt
// two sources both found shows once. Empty when no source finds anything (e.g. new users).
async function getDiscovery(
  viewerId: number,
  followedBlurts: FeedItem[],
  blurts: FeedItem[],
): Promise<DiscoverySection[]> {
  const slots = Math.max(1, Math.floor(blurts.length / discoveryInterval))
  const onPage = [...followedBlurts, ...blurts].flatMap((blurt) => [
    blurt.id,
    ...blurt.replies.map((reply) => reply.id),
  ])
  const kinds = Object.keys(discoverySources) as DiscoveryKind[]
  const found = await Promise.all(
    kinds.map((kind) => discoverySources[kind](viewerId, onPage, slots * discoverySectionSize)),
  )

  const seen = new Set<number>()
  const sectionsByKind = kinds.map((kind, k) => {
    const fresh = found[k].filter((blurt) => !seen.has(blurt.id))
    for (const blurt of fresh) {
      seen.add(blurt.id)
    }
    return Array.from({ length: Math.ceil(fresh.length / discoverySectionSize) }, (_, i) => ({
      kind,
      blurts: fresh.slice(i * discoverySectionSize, (i + 1) * discoverySectionSize),
    }))
  })
  const sections: Omit<DiscoverySection, 'after'>[] = []
  for (let i = 0; sections.length < slots && sectionsByKind.some((s) => i < s.length); i++) {
    for (const ofKind of sectionsByKind) {
      if (i < ofKind.length && sections.length < slots) {
        sections.push(ofKind[i])
      }
    }
  }
  return sections.map((section, i) => ({
    ...section,
    after: Math.min((i + 1) * discoveryInterval, blurts.length),
  }))
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
