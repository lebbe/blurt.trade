import { randomInt } from 'node:crypto'
import type pg from 'pg'
import { db, dbRead } from '../db.ts'
import type { GeoPoint } from '../geo.ts'
import { randomAvatar, type Avatar } from '../avatar.ts'
import { cursorMaxLength } from '../limits.ts'
import type { ThemeId } from '../themes.ts'
import type { CardColorId } from '../card-colors.ts'

// A deleted blurt stays in its thread as a placeholder: `deleted` is true and `username`,
// `text`, `avatar` and `quoted` are null (see deleteBlurts).
//
// A plain reblurt is never a Blurt of its own: in a list it is the original it points at,
// with `reblurtedBy` set to who reblurted it (see shownFrom). A quote-reblurt is a Blurt
// with its own text and the original in `quoted`.
export type Blurt = {
  id: number
  username: string | null
  text: string | null
  createdAt: Date
  parentId: number | null
  // The author of the blurt it replies to: null for top-level blurts, and when that blurt
  // was deleted.
  parentUsername: string | null
  replyCount: number
  avatar: Avatar | null // the blurter's
  deleted: boolean
  likeCount: number
  // Whether the viewer likes it: false for anonymous viewers (see markViewerFlags).
  viewerLikes: boolean
  // Plain reblurts; quotes aren't counted.
  reblurtCount: number
  viewerReblurted: boolean
  // Who reblurted it, when this item of a list is their plain reblurt of it.
  reblurtedBy: string | null
  // The blurt a quote-reblurt quotes, one level deep (a quote in it shows only its text).
  quoted: QuotedBlurt | null
  // Its picture, a drawing at /pictures/{id}.svg; null if none, or when it was deleted.
  picture: { width: number; height: number } | null
}

// A deleted quoted blurt has `deleted` true and `username`, `text` and `avatar` null.
export type QuotedBlurt = {
  id: number
  username: string | null
  text: string | null
  createdAt: Date
  avatar: Avatar | null
  deleted: boolean
}

// A top-level blurt on the main feed, with its latest few replies (oldest of those first).
export type FeedItem = Blurt & { replies: Blurt[] }

// One page of a list, and the cursor for the page after it (null on the last page).
export type Page<T> = { items: T[]; next: string | null }

// A position in a list ordered by (created_at, id). createdAt keeps Postgres' microseconds,
// which a JS Date would round away, so blurts in the same millisecond aren't skipped.
export type Cursor = { createdAt: string; id: number }

export type User = {
  id: number
  username: string
  passwordHash: string
}

export type UserProfile = {
  userId: number
  username: string
  homepage: string
  x: string
  instagram: string
  tiktok: string
  youtube: string
  github: string
  linkedin: string
  bio: string
  avatar: Avatar
  // The background of their share cards; null is the default (src/card-colors.ts).
  cardColor: CardColorId | null
}

export type UserProfileInput = Omit<UserProfile, 'userId' | 'username' | 'avatar'>

const pageSize = 100
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

// A row of blurts that is a plain reblurt: one that points at another blurt and has no
// text of its own. The deleted_at test matters: a deleted quote has no text either. The
// only place this is written in the app; the indexes in db/migrations/*_reblurts.sql
// repeat it.
export function plainReblurt(alias: string): string {
  return `(${alias}.reblurt_of_id IS NOT NULL AND ${alias}.text IS NULL AND ${alias}.deleted_at IS NULL)`
}

// What a row of blurts shows: the one place that resolves it, used by every list, thread,
// search and single-blurt query. `r` is the row in the list, which a query filters and
// orders by. `b` is the blurt it shows: the original when `r` is a plain reblurt (one step:
// a plain reblurt always points at content), else `r` itself. The rest hangs off `b`:
//   u   its author, never joined for a deleted blurt or a deleted account
//   ru  the reblurter, when `r` is a plain reblurt
//   st  its counters (blurt_stats; no row means zero)
//   q   the blurt a live quote quotes, and qu its author (same rules as u)
//   pb  the blurt it replies to, and pu its author (same rules as u)
const shownFrom = `blurts r
  JOIN blurts b ON b.id = CASE WHEN ${plainReblurt('r')} THEN r.reblurt_of_id ELSE r.id END
  LEFT JOIN users u ON u.id = b.user_id AND b.deleted_at IS NULL AND u.deleted_at IS NULL
  LEFT JOIN users ru ON ru.id = r.user_id AND r.id <> b.id AND ru.deleted_at IS NULL
  LEFT JOIN blurt_stats st ON st.blurt_id = b.id
  LEFT JOIN blurts q ON q.id = b.reblurt_of_id AND b.deleted_at IS NULL
  LEFT JOIN users qu ON qu.id = q.user_id AND q.deleted_at IS NULL AND qu.deleted_at IS NULL
  LEFT JOIN blurt_pictures pic ON pic.blurt_id = b.id AND b.deleted_at IS NULL
  LEFT JOIN blurts pb ON pb.id = b.parent_id
  LEFT JOIN users pu ON pu.id = pb.user_id AND pb.deleted_at IS NULL AND pu.deleted_at IS NULL`

// Leaves out stale references: a plain reblurt of a deleted blurt, or by a deleted account,
// is never shown, even before cleanup (deleteStaleReblurts) has removed it. Deleted blurts
// show as placeholders only where `placeholders` (threads and single blurts); everywhere
// else they are left out.
function shownWhere(placeholders: boolean): string {
  const reblurt = '(r.id = b.id OR (b.deleted_at IS NULL AND ru.id IS NOT NULL))'
  return placeholders ? reblurt : `${reblurt} AND b.deleted_at IS NULL`
}

// `cursorAt` and `cursorId` are the list row's (r), where a plain reblurt sits in the list,
// not the original's. toBlurt takes them and the quoted* columns off.
const shownColumns = `b.id, u.username, b.text, b.created_at AS "createdAt", b.parent_id AS "parentId",
  pu.username AS "parentUsername", pic.width AS "pictureWidth", pic.height AS "pictureHeight",
  (SELECT count(*) FROM blurts c WHERE c.parent_id = b.id)::int AS "replyCount",
  (SELECT a.avatar FROM user_profiles a WHERE a.user_id = u.id) AS avatar,
  b.deleted_at IS NOT NULL AS deleted,
  coalesce(st.like_count, 0) AS "likeCount", false AS "viewerLikes",
  coalesce(st.reblurt_count, 0) AS "reblurtCount", false AS "viewerReblurted",
  ru.username AS "reblurtedBy",
  q.id AS "quotedId", qu.username AS "quotedUsername", q.text AS "quotedText",
  q.created_at AS "quotedCreatedAt", q.deleted_at IS NOT NULL AS "quotedDeleted",
  (SELECT a.avatar FROM user_profiles a WHERE a.user_id = qu.id) AS "quotedAvatar",
  to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
  r.id AS "cursorId"`

// SELECT what the rows of blurts matching `where` (about `r`) show. The caller adds ORDER BY
// and LIMIT, and passes the rows through toBlurts.
function selectShown(where: string, { placeholders = false } = {}): string {
  return `SELECT ${shownColumns} FROM ${shownFrom} WHERE ${shownWhere(placeholders)} AND (${where})`
}

type ShownRow = Omit<Blurt, 'quoted' | 'picture'> & {
  pictureWidth: number | null
  pictureHeight: number | null
  quotedId: number | null
  quotedUsername: string | null
  quotedText: string | null
  quotedCreatedAt: Date | null
  quotedDeleted: boolean
  quotedAvatar: Avatar | null
  cursorAt: string
  cursorId: number
}

function toBlurt(row: ShownRow): Blurt {
  const {
    pictureWidth,
    pictureHeight,
    quotedId,
    quotedUsername,
    quotedText,
    quotedCreatedAt,
    quotedDeleted,
    quotedAvatar,
    cursorAt: _cursorAt,
    cursorId: _cursorId,
    ...blurt
  } = row
  const quoted =
    quotedId === null
      ? null
      : {
          id: quotedId,
          username: quotedUsername,
          text: quotedText,
          createdAt: quotedCreatedAt!,
          avatar: quotedAvatar,
          deleted: quotedDeleted,
        }
  const picture =
    pictureWidth === null || pictureHeight === null
      ? null
      : { width: pictureWidth, height: pictureHeight }
  return { ...blurt, quoted, picture }
}

async function queryShown(
  pool: Pick<pg.Pool, 'query'>,
  sql: string,
  params: unknown[],
): Promise<Blurt[]> {
  const { rows } = await pool.query<ShownRow>(sql, params)
  return rows.map(toBlurt)
}

const cursorPattern = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)_(\d{1,15})$/

// Opaque to clients: base64url keeps it a single URL-safe token they shouldn't pick apart.
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}_${cursor.id}`).toString('base64url')
}

// From the query string: null when there is no cursor, undefined when it is malformed.
export function parseCursor(value: unknown): Cursor | null | undefined {
  if (value === undefined) {
    return null
  }
  const match =
    typeof value === 'string' && value.length <= cursorMaxLength
      ? cursorPattern.exec(Buffer.from(value, 'base64url').toString())
      : null
  if (!match) {
    return undefined
  }
  // Rejects well-formed but impossible dates (e.g. month 13) before Postgres sees them.
  const date = new Date(match[1])
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 19) !== match[1].slice(0, 19)) {
    return undefined
  }
  return { createdAt: match[1], id: Number(match[2]) }
}

// Lists read from the replica (dbRead) when one is configured: feeds, profiles, replies.
// Keyset pagination on the list rows' (created_at, id), never OFFSET, so pages stay fast
// and don't shift as new blurts arrive. The indexes on (..., created_at DESC, id DESC)
// serve both orders. Fetches one extra row to know whether there is a next page.
// `placeholders`: see shownWhere.
async function listPage(
  where: string,
  params: unknown[],
  cursor: Cursor | null,
  order: 'newest first' | 'oldest first',
  { size = pageSize, placeholders = false } = {},
): Promise<Page<Blurt>> {
  const [direction, comparison] = order === 'newest first' ? ['DESC', '<'] : ['ASC', '>']
  const values = [...params, size + 1]
  const limit = `$${values.length}`
  let keyset = ''
  if (cursor) {
    values.push(cursor.createdAt, cursor.id)
    keyset = `AND (r.created_at, r.id) ${comparison} ($${values.length - 1}::timestamptz, $${values.length})`
  }
  const { rows } = await dbRead().query<ShownRow>(
    `${selectShown(where, { placeholders })} ${keyset}
     ORDER BY r.created_at ${direction}, r.id ${direction} LIMIT ${limit}`,
    values,
  )
  const last = rows.length > size ? rows[size - 1] : undefined
  const next = last ? encodeCursor({ createdAt: last.cursorAt, id: last.cursorId }) : null
  return { items: rows.slice(0, size).map(toBlurt), next }
}

const profileColumns = `p.user_id AS "userId", u.username, p.homepage, p.x, p.instagram,
  p.tiktok, p.youtube, p.github, p.linkedin, p.bio, p.avatar,
  p.card_color AS "cardColor"`

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

// Older than `before`, newest first: their blurts, replies, quotes and plain reblurts.
export function listBlurtsByUserId(
  userId: number,
  before: Cursor | null = null,
): Promise<Page<Blurt>> {
  return listPage('r.user_id = $1', [userId], before, 'newest first')
}

// The blurt with this id as it is shown, a deleted one as a placeholder. For a plain
// reblurt's id, that is the original it points at (so a like or a reply goes there); pages
// and deletion check that the id they got back is the one they asked for. Undefined for no
// such blurt, and for a plain reblurt whose original is gone.
export async function getBlurt(id: number): Promise<Blurt | undefined> {
  const [blurt] = await queryShown(db(), selectShown('r.id = $1', { placeholders: true }), [id])
  return blurt
}

// Direct replies after `after`, oldest first so the thread reads top to bottom.
export function listReplies(parentId: number, after: Cursor | null = null): Promise<Page<Blurt>> {
  return listPage('r.parent_id = $1', [parentId], after, 'oldest first', { placeholders: true })
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

// The user's coarse location, or null if they haven't set one. Only for its owner.
export async function getLocation(userId: number): Promise<GeoPoint | null> {
  const { rows } = await db().query<GeoPoint>(
    `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
     FROM user_profiles WHERE user_id = $1 AND location IS NOT NULL`,
    [userId],
  )
  return rows[0] ?? null
}

// Sets (or with null, clears) the user's location. `point` must already be snapped to a
// cell centre (snapToGrid in src/geo.ts): the database rejects anything else. False if the user has no profile
// (e.g. a still-valid token after a database reset).
export async function setLocation(userId: number, point: GeoPoint | null): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE user_profiles SET updated_at = now(), location = CASE WHEN $2::float8 IS NULL THEN NULL
       ELSE ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography END
     WHERE user_id = $1`,
    [userId, point?.lat ?? null, point?.lon ?? null],
  )
  return rowCount === 1
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

// A user found by /search.
export type UserMatch = { username: string; avatar: Avatar }

const userSearchLimit = 20

// Usernames containing `query`, ignoring case: those starting with it first (the exact
// name first of all, as the shortest), then the rest, alphabetically. strpos, not LIKE,
// so `_` and `%` are plain characters. A sequential scan of users, which stays small
// (signup_counter's hard limit); a trigram index would serve substrings if it grows.
export async function searchUsers(query: string): Promise<UserMatch[]> {
  const { rows } = await dbRead().query<UserMatch>(
    `SELECT u.username, p.avatar FROM users u JOIN user_profiles p ON p.user_id = u.id
     WHERE strpos(lower(u.username), lower($1)) > 0
     ORDER BY strpos(lower(u.username), lower($1)) = 1 DESC, length(u.username),
       lower(u.username)
     LIMIT $2`,
    [query, userSearchLimit],
  )
  return rows
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

// A live (not deleted) account, locked against deletion until the transaction ends:
// deleteAccount locks the row FOR UPDATE first.
const liveUser = 'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL'

// Returns the new blurt's id, or undefined if the user no longer exists (e.g. a
// still-valid token after a database reset). `reblurtOfId` makes it a quote of that blurt,
// which must be content (not a plain reblurt: resolve those with getBlurt first). A reply
// or quote to a blurt deleted at the same moment can still land; reads show it under the
// placeholder, or with "Content is deleted". In the same statement it notifies, if they
// have that kind switched on: the author replied to or quoted, and for a top-level blurt
// the followers (never the author themselves).
export async function addBlurt(
  userId: number,
  text: string,
  {
    parentId = null,
    reblurtOfId = null,
    picture,
  }: {
    parentId?: number | null
    reblurtOfId?: number | null
    picture?: { width: number; height: number; shapes: Buffer }
  } = {},
): Promise<number | undefined> {
  // One statement, so the blurt and its picture are saved together or not at all.
  const { rows } = await db().query<{ id: number }>(
    `WITH blurt AS (
       INSERT INTO blurts (user_id, text, parent_id, reblurt_of_id, reblurt_of_user_id)
       SELECT u.id, $2, $3, $4::bigint, (SELECT user_id FROM blurts WHERE id = $4::bigint)
       FROM (${liveUser}) u RETURNING id, user_id
     ),
     picture AS (
       INSERT INTO blurt_pictures (blurt_id, width, height, shapes)
       SELECT id, $5::smallint, $6::smallint, $7::bytea FROM blurt WHERE $7::bytea IS NOT NULL
     ),
     notify AS (
       INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id)
       SELECT n.user_id, n.kind, blurt.user_id, blurt.id
       FROM blurt, LATERAL (
         SELECT p.user_id, 'reply'::text AS kind FROM blurts p
         JOIN user_profiles up ON up.user_id = p.user_id
         WHERE p.id = $3::bigint AND p.deleted_at IS NULL AND up.notify_replies
         UNION ALL
         SELECT o.user_id, 'quote' FROM blurts o
         JOIN user_profiles up ON up.user_id = o.user_id
         WHERE o.id = $4::bigint AND o.deleted_at IS NULL AND up.notify_reblurts
         UNION ALL
         SELECT f.user_id, 'followed_blurt' FROM follows f
         JOIN user_profiles up ON up.user_id = f.user_id
         WHERE $3::bigint IS NULL AND f.followed_user_id = blurt.user_id
           AND up.notify_followed_blurts
           -- Quoted already gets the quote notification.
           AND NOT EXISTS (SELECT 1 FROM blurts o WHERE o.id = $4::bigint AND o.user_id = f.user_id)
       ) n
       WHERE n.user_id <> blurt.user_id
       ON CONFLICT DO NOTHING
     )
     SELECT id FROM blurt`,
    [
      userId,
      text,
      parentId,
      reblurtOfId,
      picture?.width ?? null,
      picture?.height ?? null,
      picture?.shapes ?? null,
    ],
  )
  return rows[0]?.id
}

// Adds `delta` to a counter in blurt_stats. Only the narrow stats row is locked, never the
// blurt, so concurrent likes and reblurts queue there briefly and each counts. A decrement
// always follows an increment that created the row.
async function bumpStat(
  client: Pick<pg.PoolClient, 'query'>,
  blurtId: number,
  column: 'like_count' | 'reblurt_count',
  delta: 1 | -1,
): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    delta > 0
      ? `INSERT INTO blurt_stats (blurt_id, ${column}) VALUES ($1, 1)
         ON CONFLICT (blurt_id) DO UPDATE SET ${column} = blurt_stats.${column} + 1
         RETURNING ${column} AS count`
      : `UPDATE blurt_stats SET ${column} = ${column} - 1 WHERE blurt_id = $1
         RETURNING ${column} AS count`,
    [blurtId],
  )
  return rows[0]?.count ?? 0
}

async function readStat(
  client: Pick<pg.PoolClient, 'query'>,
  blurtId: number,
  column: 'like_count' | 'reblurt_count',
): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT ${column} AS count FROM blurt_stats WHERE blurt_id = $1`,
    [blurtId],
  )
  return rows[0]?.count ?? 0
}

// Runs `work` in a transaction on a client of its own.
async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Removes plain reblurts whose original is deleted, at most `limit` of them, and returns
// how many it removed. Reads never show them anyway (shownWhere), so this is tidying, not
// correctness: safe to run twice, late, or concurrently. `of` limits it to the reblurts of
// those originals, as deleteBlurts does in its own transaction; without it, it sweeps the
// whole table, as a batched background job would (run it until it returns 0). The
// originals' counters went with them (deleteBlurts), so none need changing.
export async function deleteStaleReblurts({
  of = null,
  limit = 1000,
  client = db(),
}: {
  of?: number[] | null
  limit?: number
  client?: Pick<pg.PoolClient, 'query'>
} = {}): Promise<number> {
  const { rowCount } = await client.query(
    `DELETE FROM blurts WHERE id IN (
       SELECT r.id FROM blurts r JOIN blurts o ON o.id = r.reblurt_of_id
       WHERE ${plainReblurt('r')} AND o.deleted_at IS NOT NULL
         AND ($1::bigint[] IS NULL OR o.id = ANY($1::bigint[]))
       LIMIT $2
     )`,
    [of, limit],
  )
  return rowCount ?? 0
}

// Deletes blurts (content: blurts, replies, quotes), in one transaction. The rows are never
// removed: each is marked deleted_at, and its text and embedding go. It keeps user_id (the
// sharding key), parent_id and reblurt_of_id, and reads never show who wrote it (see
// shownFrom). Replies stay readable under "This blurt was deleted"; quotes of it show
// "Content is deleted". Its likes, reports, notifications and counters go, and so do the plain reblurts of
// it (deleteStaleReblurts). Plain reblurts in `ids` are skipped: un-reblurting is
// setReblurt. Account deletion (025) passes all of a user's blurts, with its own
// transaction's `client`; without one, this runs in a transaction of its own.
export async function deleteBlurts(
  ids: number[],
  client?: Pick<pg.PoolClient, 'query'>,
): Promise<void> {
  if (!client) {
    await inTransaction((own) => deleteBlurts(ids, own))
    return
  }
  // Locks the blurts first, in id order. Liking, reblurting, quoting or replying to one
  // takes a key-share lock on it until it commits, so each either lands before this (and
  // goes with the blurt, or stays under its placeholder) or waits and then finds it deleted.
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM blurts WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
       AND NOT ${plainReblurt('blurts')}
     ORDER BY id FOR UPDATE`,
    [ids],
  )
  const content = rows.map((row) => row.id)
  await client.query('DELETE FROM reports WHERE blurt_id = ANY($1::bigint[])', [content])
  await client.query('DELETE FROM likes WHERE blurt_id = ANY($1::bigint[])', [content])
  await client.query('DELETE FROM notifications WHERE blurt_id = ANY($1::bigint[])', [content])
  await client.query('DELETE FROM blurt_stats WHERE blurt_id = ANY($1::bigint[])', [content])
  await client.query('DELETE FROM blurt_pictures WHERE blurt_id = ANY($1::bigint[])', [content])
  await client.query(
    `UPDATE blurts SET deleted_at = now(), text = NULL, embedding = NULL
     WHERE id = ANY($1::bigint[])`,
    [content],
  )
  // One database for now, so in this transaction. All of them: the limit is far above what
  // one blurt gets, and anything left over is hidden on read and swept up later.
  await deleteStaleReblurts({ of: content, limit: 1_000_000, client })
}

// Deletes the account, in one transaction. The users row stays as a stub: deleted_at set,
// username and password hash removed, so blurts.user_id on the account's tombstones stays
// valid and nothing cascades from it. Everything else that refers to the user goes: their
// content through deleteBlurts (a blurt with replies from others stays as a placeholder
// that names nobody), their plain reblurts and likes (off each blurt's counters), the
// profile (avatar, location), sessions, follows both ways, notifications to and from them,
// their own invite codes and the reports they made. The code they signed up with stays used (used_at) with
// used_by_user_id set NULL. Their waitlist entry goes. The username is retired for good
// (retired_usernames), so nobody can take it and pass for them. signup_counter is left
// alone: it counts sign-ups, so a deletion doesn't free a slot. Returns the ids of the
// sessions it ended (for endDeletedAccountSessions), or undefined if the user doesn't
// exist (any more).
export async function deleteAccount(userId: number): Promise<string[] | undefined> {
  return inTransaction(async (client) => {
    // Locks the user first: posting, liking, following or reporting as them takes a
    // key-share lock on this row, so those finish before this, or wait and then find the
    // account deleted.
    const { rows } = await client.query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
      [userId],
    )
    const user = rows[0]
    if (!user) {
      return undefined
    }
    // Locks the user's blurts and the blurts they liked or reblurted, in id order, so two
    // accounts deleted at once that liked each other's blurts can't deadlock.
    await client.query(
      `SELECT 1 FROM blurts WHERE user_id = $1
         OR id IN (SELECT blurt_id FROM likes WHERE user_id = $1)
         OR id IN (SELECT reblurt_of_id FROM blurts r WHERE r.user_id = $1 AND ${plainReblurt('r')})
       ORDER BY id FOR UPDATE`,
      [userId],
    )
    await client.query(
      `WITH gone AS (DELETE FROM likes WHERE user_id = $1 RETURNING blurt_id)
       UPDATE blurt_stats s SET like_count = s.like_count - 1
       FROM gone WHERE s.blurt_id = gone.blurt_id`,
      [userId],
    )
    await client.query(
      `WITH gone AS (
         DELETE FROM blurts r WHERE r.user_id = $1 AND ${plainReblurt('r')}
         RETURNING reblurt_of_id
       )
       UPDATE blurt_stats s SET reblurt_count = s.reblurt_count - 1
       FROM gone WHERE s.blurt_id = gone.reblurt_of_id`,
      [userId],
    )
    const blurts = await client.query<{ id: number }>(
      'SELECT id FROM blurts WHERE user_id = $1 AND deleted_at IS NULL',
      [userId],
    )
    await deleteBlurts(
      blurts.rows.map((blurt) => blurt.id),
      client,
    )
    await client.query(
      'INSERT INTO retired_usernames (username) VALUES (lower($1)) ON CONFLICT DO NOTHING',
      [user.username],
    )
    await client.query('DELETE FROM waitlist WHERE lower(username) = lower($1)', [user.username])
    const sessions = await client.query<{ id: string }>(
      'DELETE FROM sessions WHERE user_id = $1 RETURNING id',
      [userId],
    )
    await client.query('DELETE FROM follows WHERE user_id = $1 OR followed_user_id = $1', [userId])
    await client.query('DELETE FROM reports WHERE user_id = $1', [userId])
    await client.query('DELETE FROM notifications WHERE user_id = $1 OR actor_user_id = $1', [
      userId,
    ])
    await client.query('DELETE FROM invite_codes WHERE user_id = $1', [userId])
    await client.query(
      'UPDATE invite_codes SET used_by_user_id = NULL WHERE used_by_user_id = $1',
      [userId],
    )
    await client.query('DELETE FROM user_profiles WHERE user_id = $1', [userId])
    await client.query(
      `UPDATE users SET deleted_at = now(), username = NULL, password_hash = NULL, is_admin = false
       WHERE id = $1`,
      [userId],
    )
    return sessions.rows.map((session) => session.id)
  })
}

// Whether the username belonged to a deleted account (see deleteAccount).
export async function isUsernameRetired(username: string): Promise<boolean> {
  const { rowCount } = await db().query(
    'SELECT 1 FROM retired_usernames WHERE username = lower($1)',
    [username],
  )
  return rowCount === 1
}

// Whether the user may moderate: see /admin/reports and delete anyone's blurt.
export async function isAdmin(userId: number): Promise<boolean> {
  const { rows } = await db().query<{ isAdmin: boolean }>(
    'SELECT is_admin AS "isAdmin" FROM users WHERE id = $1',
    [userId],
  )
  return rows[0]?.isAdmin ?? false
}

// Reports a blurt. One report per user and blurt: reporting it again does nothing, also
// after the first report was dismissed. False if the user no longer exists.
export async function addReport(userId: number, blurtId: number, reason: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `INSERT INTO reports (user_id, blurt_id, reason) SELECT id, $2, $3 FROM (${liveUser}) u
     ON CONFLICT DO NOTHING`,
    [userId, blurtId, reason],
  )
  return rowCount === 1 || (await hasReported(userId, blurtId))
}

export async function hasReported(userId: number, blurtId: number): Promise<boolean> {
  const { rowCount } = await db().query(
    'SELECT 1 FROM reports WHERE user_id = $1 AND blurt_id = $2',
    [userId, blurtId],
  )
  return rowCount === 1
}

export type Report = { reporter: string; reason: string; createdAt: Date }

// A reported blurt and its open (not dismissed) reports, oldest first.
export type ReportedBlurt = { blurt: Blurt; reports: Report[] }

const reportedBlurtsLimit = 100

// Blurts with open reports, the one waiting longest first.
export async function listOpenReports(): Promise<ReportedBlurt[]> {
  const blurts = await queryShown(
    db(),
    `SELECT x.* FROM (SELECT blurt_id, min(created_at) AS first FROM reports
                       WHERE dismissed_at IS NULL GROUP BY blurt_id) o
     CROSS JOIN LATERAL (${selectShown('r.id = o.blurt_id')}) x
     ORDER BY o.first, x.id LIMIT $1`,
    [reportedBlurtsLimit],
  )
  const { rows: reports } = await db().query<Report & { blurtId: number }>(
    `SELECT r.blurt_id AS "blurtId", u.username AS reporter, r.reason, r.created_at AS "createdAt"
     FROM reports r JOIN users u ON u.id = r.user_id
     WHERE r.dismissed_at IS NULL AND r.blurt_id = ANY($1::bigint[])
     ORDER BY r.created_at, u.username`,
    [blurts.map((blurt) => blurt.id)],
  )
  return blurts.map((blurt) => ({
    blurt,
    reports: reports
      .filter((report) => report.blurtId === blurt.id)
      .map(({ reporter, reason, createdAt }) => ({ reporter, reason, createdAt })),
  }))
}

// Dismisses every open report on the blurt: it stays up.
export async function dismissReports(blurtId: number): Promise<void> {
  await db().query(
    'UPDATE reports SET dismissed_at = now() WHERE blurt_id = $1 AND dismissed_at IS NULL',
    [blurtId],
  )
}

// Whether new people can sign up right now: 'open' below the soft limit, 'invite' (an
// invite code is needed) from the soft limit up to the hard limit, 'waitlist' at the hard
// limit. The limits live in the signup_counter row, so they can be raised without a deploy.
export type SignupState = 'open' | 'invite' | 'waitlist'

export async function getSignupState(): Promise<SignupState> {
  const { rows } = await db().query<{ state: SignupState }>(
    `SELECT CASE WHEN current_count < soft_limit THEN 'open'
                 WHEN current_count < hard_limit THEN 'invite'
                 ELSE 'waitlist' END AS state
     FROM signup_counter`,
  )
  return rows[0].state
}

// Claims a sign-up slot and creates the user, an empty profile and the user's own invite
// codes, in one transaction. Without an invite code the slot must be under the soft limit;
// with one, under the hard limit, and the code is redeemed. Returns 'taken' if the username
// is taken or retired (see deleteAccount), 'full' if there was no slot left, and
// 'invalid-code' if the code doesn't exist, is used or has expired. In all three cases
// nothing is claimed or redeemed.
export async function addUser(
  username: string,
  passwordHash: string,
  inviteCode?: string,
): Promise<User | 'taken' | 'full' | 'invalid-code'> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    // Concurrent sign-ups queue on this row's lock, and each re-checks the WHERE once the
    // one before it commits, so the count never passes the limit. The lock is held until
    // COMMIT, so nothing slow (like hashing the password) happens inside this transaction.
    const slot = await client.query(
      `UPDATE signup_counter SET current_count = current_count + 1
       WHERE current_count < ${inviteCode ? 'hard_limit' : 'soft_limit'}
       RETURNING current_count`,
    )
    if (slot.rowCount === 0) {
      await client.query('ROLLBACK')
      return 'full'
    }

    const { rows } = await client.query<User>(
      `WITH new_user AS (
         INSERT INTO users (username, password_hash) SELECT $1::text, $2::text
         WHERE NOT EXISTS (SELECT 1 FROM retired_usernames WHERE username = lower($1))
         ON CONFLICT DO NOTHING -- username taken in any letter case, or retired
         RETURNING id, username, password_hash
       ), new_profile AS (
         INSERT INTO user_profiles (user_id, avatar) SELECT id, $3::jsonb FROM new_user
       ), joined AS (
         UPDATE waitlist SET status = 'joined'
         WHERE lower(username) = lower($1) AND EXISTS (SELECT 1 FROM new_user)
       )
       SELECT id, username, password_hash AS "passwordHash" FROM new_user`,
      [username, passwordHash, JSON.stringify(randomAvatar())],
    )
    const user = rows[0]
    if (!user) {
      await client.query('ROLLBACK') // releases the slot
      return 'taken'
    }

    if (inviteCode) {
      // Single use even at the same moment: a second sign-up with this code waits on the
      // row's lock, re-checks `used_at IS NULL` once the first commits, and matches nothing.
      const redeemed = await client.query(
        `UPDATE invite_codes SET used_by_user_id = $1, used_at = now()
         WHERE code = $2 AND used_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
        [user.id, inviteCode],
      )
      if (redeemed.rowCount === 0) {
        await client.query('ROLLBACK') // releases the slot and the username
        return 'invalid-code'
      }
    }

    await mintInviteCodes(user.id, invitesPerUser, null, client)
    await client.query('COMMIT')
    return user
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// How many invite codes each new user gets to share, at sign-up.
export const invitesPerUser = 3

// No look-alikes (no 0/O, 1/I/L). 31 symbols, so 12 of them are about 59 random bits: far
// too many to guess. Must match the CHECK in db/migrations/*_invite-codes.sql.
const inviteAlphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const inviteCodeLength = 12

function generateInviteCode(): string {
  return Array.from(
    { length: inviteCodeLength },
    () => inviteAlphabet[randomInt(inviteAlphabet.length)],
  ).join('')
}

// A code as people type or paste it: any letter case, with spaces or dashes. Returns the
// code as stored, or undefined if it can't be one.
export function normalizeInviteCode(input: string): string | undefined {
  const code = input.replace(/[\s-]/g, '').toUpperCase()
  const valid =
    code.length === inviteCodeLength && [...code].every((c) => inviteAlphabet.includes(c))
  return valid ? code : undefined
}

// Creates `count` new codes owned by the user. `client` lets addUser do it inside its
// transaction. Admins mint in bulk with `node db/mint-invites.ts`.
export async function mintInviteCodes(
  userId: number,
  count: number,
  expiresAt: Date | null = null,
  client: Pick<pg.PoolClient, 'query'> = db(),
): Promise<string[]> {
  const codes = Array.from({ length: count }, generateInviteCode)
  await client.query(
    'INSERT INTO invite_codes (code, user_id, expires_at) SELECT unnest($1::text[]), $2, $3',
    [codes, userId, expiresAt],
  )
  return codes
}

// One of the user's own codes, as listed on their profile. `usedBy` is the username of
// whoever signed up with it.
export type InviteCode = {
  code: string
  usedBy: string | null
  usedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

// Unused codes first, so the ones left to share are on top.
export async function listInviteCodes(userId: number): Promise<InviteCode[]> {
  const { rows } = await db().query<InviteCode>(
    `SELECT i.code, u.username AS "usedBy", i.used_at AS "usedAt",
       i.expires_at AS "expiresAt", i.created_at AS "createdAt"
     FROM invite_codes i LEFT JOIN users u ON u.id = i.used_by_user_id
     WHERE i.user_id = $1
     ORDER BY i.used_at IS NOT NULL, i.used_at DESC, i.created_at, i.code`,
    [userId],
  )
  return rows
}

// The username of whoever invited the user, or null if they signed up without a code.
export async function getInvitedBy(userId: number): Promise<string | null> {
  const { rows } = await db().query<{ username: string }>(
    `SELECT u.username FROM invite_codes i JOIN users u ON u.id = i.user_id
     WHERE i.used_by_user_id = $1`,
    [userId],
  )
  return rows[0]?.username ?? null
}

// Someone who asked to be let in once sign-up was full. No personal data: only the
// username they'd like, which isn't reserved for them.
export type WaitlistEntry = {
  username: string
  status: 'waiting' | 'joined'
  createdAt: Date
}

// Adds the username to the waitlist. Joining twice, in any letter case, does nothing.
export async function joinWaitlist(username: string): Promise<WaitlistEntry> {
  await db().query('INSERT INTO waitlist (username) VALUES ($1) ON CONFLICT DO NOTHING', [username])
  return (await getWaitlistEntry(username))!
}

export async function getWaitlistEntry(username: string): Promise<WaitlistEntry | undefined> {
  const { rows } = await db().query<WaitlistEntry>(
    `SELECT username, status, created_at AS "createdAt" FROM waitlist
     WHERE lower(username) = lower($1)`,
    [username],
  )
  return rows[0]
}

export async function countWaiting(): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM waitlist WHERE status = 'waiting'`,
  )
  return rows[0].count
}

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const { rows } = await db().query<User>(
    `SELECT id, username, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
    [username],
  )
  return rows[0]
}

export async function getUserProfileByUsername(username: string): Promise<UserProfile | undefined> {
  const { rows } = await db().query<UserProfile>(
    `SELECT ${profileColumns} FROM user_profiles p JOIN users u ON u.id = p.user_id
     WHERE lower(u.username) = lower($1)`,
    [username],
  )
  return rows[0]
}

export async function updateUserProfile(
  userId: number,
  input: UserProfileInput,
): Promise<UserProfile> {
  const { rows } = await db().query<UserProfile>(
    `UPDATE user_profiles p SET homepage = $2, x = $3, instagram = $4, tiktok = $5,
       youtube = $6, github = $7, linkedin = $8, bio = $9, card_color = $10, updated_at = now()
     FROM users u WHERE u.id = p.user_id AND p.user_id = $1
     RETURNING ${profileColumns}`,
    [
      userId,
      input.homepage,
      input.x,
      input.instagram,
      input.tiktok,
      input.youtube,
      input.github,
      input.linkedin,
      input.bio,
      input.cardColor,
    ],
  )
  if (!rows[0]) {
    throw new Error(`Missing profile for user ${userId}`)
  }
  return rows[0]
}

// The card colour of a user, by username: null for the default, and for no such user.
export async function getCardColor(username: string): Promise<CardColorId | null> {
  const { rows } = await dbRead().query<{ cardColor: CardColorId | null }>(
    `SELECT p.card_color AS "cardColor" FROM user_profiles p JOIN users u ON u.id = p.user_id
     WHERE lower(u.username) = lower($1)`,
    [username],
  )
  return rows[0]?.cardColor ?? null
}

// Replaces the user's avatar (already validated: avatarSchema in src/avatar.ts). False if
// the user has no profile (e.g. a still-valid token after a database reset).
export async function setAvatar(userId: number, avatar: Avatar): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET avatar = $2::jsonb, updated_at = now() WHERE user_id = $1',
    [userId, JSON.stringify(avatar)],
  )
  return rowCount === 1
}

// The colour theme (src/themes.ts). False when the user no longer exists.
export async function setTheme(userId: number, theme: ThemeId): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET theme = $2, updated_at = now() WHERE user_id = $1',
    [userId, theme],
  )
  return rowCount === 1
}

// The time zone and the language of dates and times (src/timezones.ts); a field left out
// stays as it was, a null locale goes back to the browser's. False when the user no longer
// exists.
export async function setTimeSettings(
  userId: number,
  { timeZone, locale }: { timeZone?: string; locale?: string | null },
): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE user_profiles
     SET timezone = CASE WHEN $2::boolean THEN $3 ELSE timezone END,
         locale = CASE WHEN $4::boolean THEN $5 ELSE locale END,
         updated_at = now()
     WHERE user_id = $1`,
    [userId, timeZone !== undefined, timeZone ?? null, locale !== undefined, locale ?? null],
  )
  return rowCount === 1
}

// Which notifications a user wants (see the notifications table). Reblurts and quotes share
// a switch. Private: never part of UserProfile, which is public.
export type NotificationSettings = {
  followedBlurts: boolean
  replies: boolean
  reblurts: boolean
}

export async function getNotificationSettings(userId: number): Promise<NotificationSettings> {
  const { rows } = await db().query<NotificationSettings>(
    `SELECT notify_followed_blurts AS "followedBlurts", notify_replies AS replies,
       notify_reblurts AS reblurts
     FROM user_profiles WHERE user_id = $1`,
    [userId],
  )
  return rows[0] ?? { followedBlurts: false, replies: true, reblurts: true }
}

// Replaces all three switches. Notifications already created stay; switching a kind off only
// stops new ones. False when the user no longer exists.
export async function setNotificationSettings(
  userId: number,
  { followedBlurts, replies, reblurts }: NotificationSettings,
): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE user_profiles
     SET notify_followed_blurts = $2, notify_replies = $3, notify_reblurts = $4, updated_at = now()
     WHERE user_id = $1`,
    [userId, followedBlurts, replies, reblurts],
  )
  return rowCount === 1
}

export type NotificationKind = 'followed_blurt' | 'reply' | 'reblurt' | 'quote'

// `blurtId` and `blurtUsername` are what the notification links to: the new blurt, reply or
// quote by `actor`, or for a reblurt the user's own blurt that was reblurted. `text` is that
// blurt's text. Deleted blurts and accounts leave no notification (deleteBlurts, deleteAccount).
export type Notification = {
  id: number
  kind: NotificationKind
  actor: string
  avatar: Avatar | null
  blurtId: number
  blurtUsername: string
  text: string | null
  createdAt: Date
  read: boolean
}

// The unread count shows at most this many ("99+" above 99), so counting stops there.
export const unreadCap = 100

// Queried on every page for logged-in users: the partial index
// notifications_unread_idx makes it a short index scan.
export async function countUnreadNotifications(userId: number): Promise<number> {
  const { rows } = await dbRead().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT 1 FROM notifications WHERE user_id = $1 AND read_at IS NULL LIMIT ${unreadCap}
     ) unread`,
    [userId],
  )
  return rows[0]?.count ?? 0
}

type NotificationRow = Notification & { cursorAt: string }

// A user's notifications, newest first, the unread ones or (`read`) the read ones.
export async function listNotifications(
  userId: number,
  read: boolean,
  before: Cursor | null,
): Promise<Page<Notification>> {
  const values: unknown[] = [userId, read, pageSize + 1]
  let keyset = ''
  if (before) {
    values.push(before.createdAt, before.id)
    keyset = 'AND (n.created_at, n.id) < ($4::timestamptz, $5)'
  }
  const { rows } = await dbRead().query<NotificationRow>(
    `SELECT n.id, n.kind, au.username AS actor,
       (SELECT a.avatar FROM user_profiles a WHERE a.user_id = au.id) AS avatar,
       b.id AS "blurtId", bu.username AS "blurtUsername", b.text,
       n.created_at AS "createdAt", n.read_at IS NOT NULL AS read,
       to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt"
     FROM notifications n
     JOIN users au ON au.id = n.actor_user_id AND au.deleted_at IS NULL
     JOIN blurts b ON b.id = n.blurt_id AND b.deleted_at IS NULL
     JOIN users bu ON bu.id = b.user_id AND bu.deleted_at IS NULL
     WHERE n.user_id = $1 AND (n.read_at IS NOT NULL) = $2 ${keyset}
     ORDER BY n.created_at DESC, n.id DESC LIMIT $3`,
    values,
  )
  const last = rows.length > pageSize ? rows[pageSize - 1] : undefined
  const next = last ? encodeCursor({ createdAt: last.cursorAt, id: last.id }) : null
  return {
    items: rows.slice(0, pageSize).map(({ cursorAt: _cursorAt, ...notification }) => notification),
    next,
  }
}

// Marks one notification of the user's (`id`), or all of them, as read. Marking a read one
// again changes nothing. Returns how many are unread now, or undefined if `id` is not one
// of the user's.
export async function markNotificationsRead(
  userId: number,
  id: number | null,
): Promise<number | undefined> {
  const { rowCount } = await db().query(
    `UPDATE notifications SET read_at = coalesce(read_at, now())
     WHERE user_id = $1 AND ($2::bigint IS NULL OR id = $2)`,
    [userId, id],
  )
  if (id !== null && rowCount === 0) {
    return undefined
  }
  const { rows } = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT 1 FROM notifications WHERE user_id = $1 AND read_at IS NULL LIMIT ${unreadCap}
     ) unread`,
    [userId],
  )
  return rows[0]?.count ?? 0
}

// Read notifications are kept this long, then pruned. Unread ones stay until read.
const readNotificationDays = 90

// Deletes read notifications older than that, at most `limit` per call; run until it
// returns less. Housekeeping, like deleteDeadSessions.
export async function pruneNotifications(limit = 10_000): Promise<number> {
  const { rowCount } = await db().query(
    `DELETE FROM notifications WHERE id IN (
       SELECT id FROM notifications
       WHERE read_at IS NOT NULL AND read_at < now() - make_interval(days => $1)
       LIMIT $2
     )`,
    [readNotificationDays, limit],
  )
  return rowCount ?? 0
}

export async function countFollowing(userId: number): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    'SELECT count(*)::int AS count FROM follows WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.count ?? 0
}

// Follower and following counts for a profile, and whether the viewer follows it
// (false for anonymous viewers and on your own profile).
export type FollowStats = { followerCount: number; followingCount: number; viewerFollows: boolean }

export async function getFollowStats(
  userId: number,
  viewerId: number | null,
): Promise<FollowStats> {
  const { rows } = await db().query<FollowStats>(
    `SELECT
       (SELECT count(*) FROM follows WHERE followed_user_id = $1)::int AS "followerCount",
       (SELECT count(*) FROM follows WHERE user_id = $1)::int AS "followingCount",
       EXISTS (SELECT 1 FROM follows WHERE user_id = $2 AND followed_user_id = $1)
         AS "viewerFollows"`,
    [userId, viewerId],
  )
  return rows[0] ?? { followerCount: 0, followingCount: 0, viewerFollows: false }
}

// Both are idempotent: following twice or unfollowing someone you don't follow is a no-op.
// Returns false if the follower no longer exists (e.g. a still-valid token after a reset).
export async function follow(userId: number, followedUserId: number): Promise<boolean> {
  const { rowCount } = await db().query(
    `INSERT INTO follows (user_id, followed_user_id) SELECT id, $2 FROM (${liveUser}) u
     ON CONFLICT DO NOTHING`,
    [userId, followedUserId],
  )
  return rowCount === 1 || (await isFollowing(userId, followedUserId))
}

async function isFollowing(userId: number, followedUserId: number): Promise<boolean> {
  const { rowCount } = await db().query(
    'SELECT 1 FROM follows WHERE user_id = $1 AND followed_user_id = $2',
    [userId, followedUserId],
  )
  return rowCount === 1
}

export async function unfollow(userId: number, followedUserId: number): Promise<void> {
  await db().query('DELETE FROM follows WHERE user_id = $1 AND followed_user_id = $2', [
    userId,
    followedUserId,
  ])
}

// Sets `viewerLikes` and `viewerReblurted` on the blurts, a feed item's replies included:
// one query for a whole page, never one per blurt. Does nothing for anonymous viewers.
export async function markViewerFlags(
  viewerId: number | null,
  blurts: (Blurt | FeedItem | null)[],
): Promise<void> {
  const all = blurts.flatMap((blurt) =>
    blurt === null ? [] : [blurt, ...('replies' in blurt ? blurt.replies : [])],
  )
  if (viewerId === null || all.length === 0) {
    return
  }
  const { rows } = await dbRead().query<{ blurtId: number; flag: 'like' | 'reblurt' }>(
    `SELECT blurt_id AS "blurtId", 'like' AS flag FROM likes
     WHERE user_id = $1 AND blurt_id = ANY($2::bigint[])
     UNION ALL
     SELECT reblurt_of_id, 'reblurt' FROM blurts r
     WHERE r.user_id = $1 AND r.reblurt_of_id = ANY($2::bigint[]) AND ${plainReblurt('r')}`,
    [viewerId, all.map((blurt) => blurt.id)],
  )
  const flagged = new Set(rows.map((row) => `${row.flag}:${row.blurtId}`))
  for (const blurt of all) {
    blurt.viewerLikes = flagged.has(`like:${blurt.id}`)
    blurt.viewerReblurted = flagged.has(`reblurt:${blurt.id}`)
  }
}

// Locks the user and then the blurt with key-share locks, the order deleteAccount locks
// them in, for liking or reblurting it. deleteBlurts and deleteAccount take FOR UPDATE, so
// the like or reblurt either lands first (and goes with the blurt or the account) or waits
// and then finds it deleted. Other likes and reblurts of the blurt don't wait for each
// other here, only briefly on its blurt_stats row. The blurt must be content: not deleted,
// not a plain reblurt. Returns its author, or why it can't be done.
async function lockForAction(
  client: Pick<pg.PoolClient, 'query'>,
  userId: number,
  blurtId: number,
): Promise<{ authorId: number } | 'not-found' | 'no-user'> {
  const user = await client.query(`${liveUser} FOR KEY SHARE`, [userId])
  if (user.rowCount === 0) {
    return 'no-user'
  }
  const { rows } = await client.query<{ authorId: number }>(
    `SELECT user_id AS "authorId" FROM blurts
     WHERE id = $1 AND deleted_at IS NULL AND NOT ${plainReblurt('blurts')}
     FOR KEY SHARE`,
    [blurtId],
  )
  return rows[0] ?? 'not-found'
}

export type LikeState = { blurtId: number; likeCount: number; viewerLikes: boolean }

// Likes (or with `likes` false, unlikes) a blurt. Liking twice, or unliking a blurt you
// don't like, changes nothing, so concurrent likes are each counted once (see bumpStat).
// Deleted blurts, placeholders and plain reblurts can't be liked: like the original.
// Returns the new state, 'not-found' for no such blurt, or 'no-user' if the user no longer
// exists (e.g. a still-valid token after a database reset).
export function setLike(
  userId: number,
  blurtId: number,
  likes: boolean,
): Promise<LikeState | 'not-found' | 'no-user'> {
  return inTransaction(async (client) => {
    const locked = await lockForAction(client, userId, blurtId)
    if (typeof locked === 'string') {
      return locked
    }
    const changed = likes
      ? await client.query(
          'INSERT INTO likes (user_id, blurt_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, blurtId],
        )
      : await client.query('DELETE FROM likes WHERE user_id = $1 AND blurt_id = $2', [
          userId,
          blurtId,
        ])
    const likeCount =
      changed.rowCount === 1
        ? await bumpStat(client, blurtId, 'like_count', likes ? 1 : -1)
        : await readStat(client, blurtId, 'like_count')
    return { blurtId, likeCount, viewerLikes: likes }
  })
}

export type ReblurtState = { blurtId: number; reblurtCount: number; viewerReblurted: boolean }

// Plain-reblurts (or with `reblurts` false, un-reblurts) a blurt, which must be content:
// pass the original, never a plain reblurt (getBlurt resolves one to its original).
// Reblurting twice, or un-reblurting what you didn't reblurt, changes nothing: one plain
// reblurt per user and blurt (blurts_plain_reblurt_key). Un-reblurting deletes the row,
// like unliking: a plain reblurt has no content and nothing hangs off it. Your own blurts
// can't be reblurted ('own'; quoting them is fine). Locks and counts like setLike.
export function setReblurt(
  userId: number,
  blurtId: number,
  reblurts: boolean,
): Promise<ReblurtState | 'not-found' | 'no-user' | 'own'> {
  return inTransaction(async (client) => {
    const locked = await lockForAction(client, userId, blurtId)
    if (typeof locked === 'string') {
      return locked
    }
    if (reblurts && locked.authorId === userId) {
      return 'own'
    }
    const changed = reblurts
      ? await client.query(
          `INSERT INTO blurts (user_id, reblurt_of_id, reblurt_of_user_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, blurtId, locked.authorId],
        )
      : await client.query(
          `DELETE FROM blurts r WHERE r.user_id = $1 AND r.reblurt_of_id = $2
             AND ${plainReblurt('r')}`,
          [userId, blurtId],
        )
    if (changed.rowCount === 1) {
      await (reblurts
        ? client.query(
            `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id)
             SELECT $1, 'reblurt', $2, $3 FROM user_profiles WHERE user_id = $1 AND notify_reblurts
             ON CONFLICT DO NOTHING`,
            [locked.authorId, userId, blurtId],
          )
        : client.query(
            `DELETE FROM notifications
             WHERE user_id = $1 AND kind = 'reblurt' AND actor_user_id = $2 AND blurt_id = $3`,
            [locked.authorId, userId, blurtId],
          ))
    }
    const reblurtCount =
      changed.rowCount === 1
        ? await bumpStat(client, blurtId, 'reblurt_count', reblurts ? 1 : -1)
        : await readStat(client, blurtId, 'reblurt_count')
    return { blurtId, reblurtCount, viewerReblurted: reblurts }
  })
}

// The stored drawing of a blurt's picture (see src/picture.ts), if it has one and is not deleted.
export async function getPictureShapes(blurtId: number): Promise<Buffer | undefined> {
  const { rows } = await dbRead().query<{ shapes: Buffer }>(
    `SELECT pic.shapes FROM blurt_pictures pic JOIN blurts b ON b.id = pic.blurt_id
     WHERE pic.blurt_id = $1 AND b.deleted_at IS NULL`,
    [blurtId],
  )
  return rows[0]?.shapes
}
