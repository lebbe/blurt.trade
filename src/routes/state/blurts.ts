import type pg from 'pg'
import type { Avatar } from '../../avatar.ts'
import { db, dbRead } from '../../db.ts'
import { cursorMaxLength } from '../../limits.ts'
import { hiddenBot, withoutHiddenBots } from './bots.ts'

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

export const pageSize = 100

// The avatar of a user_profiles row (by its alias) as it is shown: the stored JSON, plus
// `photo` when they have a profile picture (AvatarPhoto in src/avatar.ts). The picture
// itself is never read here: IS NULL doesn't fetch it.
// A bot's gets `robot: true` instead, and never a photo: the robot is its label.
export function avatarColumn(profile: string): string {
  return `(${profile}.avatar || CASE
    WHEN (SELECT is_bot FROM users WHERE id = ${profile}.user_id) THEN '{"robot": true}'::jsonb
    WHEN ${profile}.picture IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('photo', jsonb_build_object('user', ${profile}.user_id,
      'version', ${profile}.picture_version, 'cut', ${profile}.picture_cut)) END)`
}

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
  (SELECT ${avatarColumn('a')} FROM user_profiles a WHERE a.user_id = u.id) AS avatar,
  b.deleted_at IS NOT NULL AS deleted,
  coalesce(st.like_count, 0) AS "likeCount", false AS "viewerLikes",
  coalesce(st.reblurt_count, 0) AS "reblurtCount", false AS "viewerReblurted",
  ru.username AS "reblurtedBy",
  q.id AS "quotedId", qu.username AS "quotedUsername", q.text AS "quotedText",
  q.created_at AS "quotedCreatedAt", q.deleted_at IS NOT NULL AS "quotedDeleted",
  (SELECT ${avatarColumn('a')} FROM user_profiles a WHERE a.user_id = qu.id) AS "quotedAvatar",
  to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
  r.id AS "cursorId"`

// SELECT what the rows of blurts matching `where` (about `r`) show. The caller adds ORDER BY
// and LIMIT, and passes the rows through toBlurts.
export function selectShown(where: string, { placeholders = false } = {}): string {
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

export async function queryShown(
  pool: Pick<pg.Pool, 'query'>,
  sql: string,
  params: unknown[],
): Promise<Blurt[]> {
  const { rows } = await pool.query<ShownRow>(sql, params)
  return rows.map(toBlurt)
}

const cursorPattern = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)_(\d{1,15})$/

// Opaque to clients: base64url keeps it a single URL-safe token they shouldn't pick apart.
export function encodeCursor(cursor: Cursor): string {
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
export async function listPage(
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
// Leaves out the bots `viewerId` hides.
export function listReplies(
  parentId: number,
  after: Cursor | null = null,
  viewerId: number | null = null,
): Promise<Page<Blurt>> {
  return listPage(
    `r.parent_id = $1 AND ${withoutHiddenBots(viewerId)}`,
    [parentId],
    after,
    'oldest first',
    {
      placeholders: true,
    },
  )
}

// A live (not deleted) account, locked against deletion until the transaction ends:
// deleteAccount locks the row FOR UPDATE first.
export const liveUser = 'SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL'

// Returns the new blurt's id, or undefined if the user no longer exists (e.g. a
// still-valid token after a database reset). `reblurtOfId` makes it a quote of that blurt,
// which must be content (not a plain reblurt: resolve those with getBlurt first). A reply
// or quote to a blurt deleted at the same moment can still land; reads show it under the
// placeholder, or with "Content is deleted". In the same statement it notifies, if they
// have that kind switched on: the author replied to or quoted, and for a top-level blurt
// the followers (never the author themselves). `onNotified` gets the ids of the users it
// notified, once the blurt is saved (the route pushes to their devices, src/push.ts).
export async function addBlurt(
  userId: number,
  text: string,
  {
    parentId = null,
    reblurtOfId = null,
    picture,
    onNotified,
  }: {
    parentId?: number | null
    reblurtOfId?: number | null
    picture?: { width: number; height: number; shapes: Buffer }
    onNotified?: (userIds: number[]) => void
  } = {},
): Promise<number | undefined> {
  // One statement, so the blurt and its picture are saved together or not at all.
  const { rows } = await db().query<{ id: number; notified: number[] | null }>(
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
       -- Not to people who hide this bot (src/routes/state/bots.ts).
       WHERE n.user_id <> blurt.user_id AND NOT ${hiddenBot('blurt.user_id', 'n.user_id')}
       ON CONFLICT DO NOTHING
       RETURNING user_id
     )
     SELECT id, (SELECT array_agg(user_id) FROM notify) AS notified FROM blurt`,
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
  if (rows[0]?.notified) {
    // bigint[] comes back as strings (only single bigints are parsed, src/db.ts).
    onNotified?.(rows[0].notified.map(Number))
  }
  return rows[0]?.id
}

// Runs `work` in a transaction on a client of its own.
export async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

// The stored drawing of a blurt's picture (see src/picture.ts), if it has one and is not deleted.
export async function getPictureShapes(blurtId: number): Promise<Buffer | undefined> {
  const { rows } = await dbRead().query<{ shapes: Buffer }>(
    `SELECT pic.shapes FROM blurt_pictures pic JOIN blurts b ON b.id = pic.blurt_id
     WHERE pic.blurt_id = $1 AND b.deleted_at IS NULL`,
    [blurtId],
  )
  return rows[0]?.shapes
}

// The stored shapes of the pictures of these blurts, by blurt id; none for deleted blurts.
export async function getPicturesShapes(blurtIds: number[]): Promise<Map<number, Buffer>> {
  if (blurtIds.length === 0) {
    return new Map()
  }
  const { rows } = await dbRead().query<{ id: string; shapes: Buffer }>(
    `SELECT pic.blurt_id AS id, pic.shapes FROM blurt_pictures pic
     JOIN blurts b ON b.id = pic.blurt_id
     WHERE pic.blurt_id = ANY($1::bigint[]) AND b.deleted_at IS NULL`,
    [blurtIds],
  )
  return new Map(rows.map((row) => [Number(row.id), row.shapes]))
}
