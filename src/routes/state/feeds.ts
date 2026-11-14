import { dbRead } from '../../db.ts'
import {
  type Blurt,
  type Cursor,
  type FeedItem,
  listPage,
  type Page,
  plainReblurt,
  queryShown,
  selectShown,
} from './blurts.ts'

const feedRepliesPerBlurt = 2

// Following more than this many accounts makes / the following feed. Up to it, / is the
// everyone feed with the latest few blurts from followed accounts on top.
export const followingFeedThreshold = 10

const followedHighlightsLimit = 5

const relatedLimit = 5

// Cosine distance (0 = same meaning, 1 = unrelated). With all-MiniLM-L6-v2, short blurts on
// the same topic land around 0.6-0.7 and unrelated ones above 0.8. The same holds against
// the average of someone's blurts (discovery): 0.5-0.7 on their topics, 0.83+ off them.
const relatedMaxDistance = 0.75

const followedBy = (userId: string) =>
  `(SELECT followed_user_id FROM follows WHERE user_id = ${userId})`

// Top-level blurts and plain reblurts from accounts the user follows. The planner walks
// each followed user's (user_id, created_at DESC, id DESC) index. A blurt shows once, at
// its newest row: the original or the latest plain reblurt of it by someone followed.
const followedWhere = `r.parent_id IS NULL AND r.user_id IN ${followedBy('$1')}
  AND NOT EXISTS (
    SELECT 1 FROM blurts n
    WHERE (n.id = b.id OR (n.reblurt_of_id = b.id AND ${plainReblurt('n')}))
      AND n.parent_id IS NULL AND n.deleted_at IS NULL AND n.user_id IN ${followedBy('$1')}
      AND (n.created_at, n.id) > (r.created_at, r.id)
  )`

// Top-level blurts older than `before`, newest first, each with its latest replies.
// With `followedBy`, only blurts from accounts that user follows and what they reblurted
// (the following feed). The everyone feed leaves plain reblurts out: their originals are
// in it already.
export async function listFeed(
  before: Cursor | null = null,
  followedBy: number | null = null,
): Promise<Page<FeedItem>> {
  const page =
    followedBy === null
      ? await listPage(
          `r.parent_id IS NULL AND NOT ${plainReblurt('r')}`,
          [],
          before,
          'newest first',
        )
      : await listPage(followedWhere, [followedBy], before, 'newest first')
  return { items: await withReplies(page.items), next: page.next }
}

// The latest few blurts from accounts the user follows, for the top of the everyone feed.
export async function listFollowedHighlights(userId: number): Promise<FeedItem[]> {
  const { items } = await listPage(followedWhere, [userId], null, 'newest first', {
    size: followedHighlightsLimit,
  })
  return withReplies(items)
}

// Adds each blurt's latest replies, oldest of those first.
async function withReplies(blurts: Blurt[]): Promise<FeedItem[]> {
  const replies = await queryShown(
    dbRead(),
    `SELECT x.* FROM unnest($1::bigint[]) AS p(id) CROSS JOIN LATERAL (
       ${selectShown('r.parent_id = p.id', { placeholders: true })}
       ORDER BY r.created_at DESC, r.id DESC LIMIT $2
     ) x ORDER BY x."createdAt", x.id`,
    [blurts.map((blurt) => blurt.id), feedRepliesPerBlurt],
  )
  return blurts.map((blurt) => ({
    ...blurt,
    replies: replies.filter((reply) => reply.parentId === blurt.id),
  }))
}

// Closest blurts by meaning, excluding the blurt itself and its direct replies (shown anyway).
// Empty until the blurt's embedding has been computed. Only rows with text have one, so
// plain reblurts are never among them.
export function listRelatedBlurts(id: number): Promise<Blurt[]> {
  return queryShown(
    dbRead(),
    `WITH target AS (SELECT embedding FROM blurts WHERE id = $1 AND embedding IS NOT NULL)
     ${selectShown(
       `r.id <> $1 AND r.parent_id IS DISTINCT FROM $1 AND r.embedding IS NOT NULL
        AND r.embedding <=> (SELECT embedding FROM target) < $3`,
     )}
     ORDER BY r.embedding <=> (SELECT embedding FROM target) LIMIT $2`,
    [id, relatedLimit, relatedMaxDistance],
  )
}

// How many of the user's latest blurts (posts and replies alike) make up their taste.
const tasteBlurts = 20

// Top-level blurts close in meaning to what the user has blurted lately: the average of
// their latest embeddings. Leaves out their own blurts, blurts from accounts they follow
// (those are in the feed anyway) and `excludeIds` (already on the page). Empty for users
// with no embedded blurts yet.
export function listSimilarToUser(
  userId: number,
  excludeIds: number[],
  limit: number,
): Promise<Blurt[]> {
  return queryShown(
    dbRead(),
    `WITH taste AS (
       SELECT avg(embedding) AS embedding FROM (
         SELECT embedding FROM blurts WHERE user_id = $1 AND embedding IS NOT NULL
         ORDER BY created_at DESC, id DESC LIMIT $2
       ) recent
     )
     ${selectShown(
       `r.parent_id IS NULL AND r.embedding IS NOT NULL
        AND r.user_id <> $1 AND r.user_id NOT IN ${followedBy('$1')}
        AND r.id <> ALL ($3::bigint[])
        AND r.embedding <=> (SELECT embedding FROM taste) < $5`,
     )}
     ORDER BY r.embedding <=> (SELECT embedding FROM taste) LIMIT $4`,
    [userId, tasteBlurts, excludeIds, limit, relatedMaxDistance],
  )
}

// Top-level blurts from other people whose location is within `radiusKm` of the user's.
// The GiST index on user_profiles.location serves ST_DWithin. Matches nothing when the user
// has no location (ST_DWithin on NULL is NULL).
// Their own blurts only, not what they reblurted.
const nearbyWhere = `r.parent_id IS NULL AND NOT ${plainReblurt('r')}
  AND r.user_id <> $1 AND r.user_id IN (
    SELECT p.user_id FROM user_profiles me JOIN user_profiles p
      ON ST_DWithin(p.location, me.location, $2::float8 * 1000)
    WHERE me.user_id = $1
  )`

// "Blurts near you": older than `before`, newest first, each with its latest replies.
export async function listNearbyBlurts(
  userId: number,
  radiusKm: number,
  before: Cursor | null = null,
): Promise<Page<FeedItem>> {
  const page = await listPage(nearbyWhere, [userId, radiusKm], before, 'newest first')
  return { items: await withReplies(page.items), next: page.next }
}

// How far away "Near you" discovery in the feed reaches.
const nearbyDiscoveryKm = 250

// Discovery: the latest top-level blurts from people near the user, leaving out accounts
// they follow and `excludeIds` (already on the page). Empty without a location.
export function listNearbyForUser(
  userId: number,
  excludeIds: number[],
  limit: number,
): Promise<Blurt[]> {
  return queryShown(
    dbRead(),
    `${selectShown(
      `${nearbyWhere} AND r.user_id NOT IN ${followedBy('$1')} AND r.id <> ALL ($3::bigint[])`,
    )}
     ORDER BY r.created_at DESC, r.id DESC LIMIT $4`,
    [userId, nearbyDiscoveryKm, excludeIds, limit],
  )
}

// Must match the expression of blurts_text_search_idx exactly, or the index isn't used.
// websearch_to_tsquery takes any input without a syntax error: words are ANDed, "quoted
// phrases", `or` and `-word` work like a web search. Punctuation alone matches nothing.
// Deleted blurts and plain reblurts have no text, so they never match.
export const blurtSearchWhere = `to_tsvector('simple', r.text) @@ websearch_to_tsquery('simple', $1)`

// Blurts, replies and quotes whose text matches `query`, newest first, paged like the feeds.
export function searchBlurts(query: string, before: Cursor | null = null): Promise<Page<Blurt>> {
  return listPage(blurtSearchWhere, [query], before, 'newest first')
}
