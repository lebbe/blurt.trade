import { randomInt } from 'node:crypto'
import type pg from 'pg'
import { db, dbRead } from '../db.ts'
import type { GeoPoint } from '../geo.ts'
import { randomAvatar, type Avatar } from '../avatar.ts'
import { cursorMaxLength } from '../limits.ts'

// A deleted blurt that had replies stays in its thread as a placeholder: `deleted` is true
// and `username`, `text` and `avatar` are null (see deleteBlurts).
export type Blurt = {
  id: number
  username: string | null
  text: string | null
  createdAt: Date
  parentId: number | null
  replyCount: number
  avatar: Avatar | null // the blurter's
  deleted: boolean
  likeCount: number
  // Whether the viewer likes it: false for anonymous viewers (see markViewerLikes).
  viewerLikes: boolean
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

const blurtColumns = `b.id, u.username, b.text, b.created_at AS "createdAt", b.parent_id AS "parentId",
  (SELECT count(*) FROM blurts r WHERE r.parent_id = b.id)::int AS "replyCount",
  (SELECT a.avatar FROM user_profiles a WHERE a.user_id = b.user_id) AS avatar,
  b.deleted_at IS NOT NULL AS deleted, b.like_count AS "likeCount", false AS "viewerLikes"`

// LEFT JOIN where deleted placeholders (no user) belong: threads. Lists of blurts by
// someone, near someone or like something never match a placeholder anyway.
const threadFrom = 'blurts b LEFT JOIN users u ON u.id = b.user_id'

const cursorColumn = `to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  AS "cursorAt"`

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
// Keyset pagination on (created_at, id), never OFFSET, so pages stay fast and don't shift
// as new blurts arrive. The indexes on (..., created_at DESC, id DESC) serve both orders.
// Fetches one extra row to know whether there is a next page.
async function listPage(
  where: string,
  params: unknown[],
  cursor: Cursor | null,
  order: 'newest first' | 'oldest first',
  size = pageSize,
): Promise<Page<Blurt>> {
  const [direction, comparison] = order === 'newest first' ? ['DESC', '<'] : ['ASC', '>']
  const values = [...params, size + 1]
  const limit = `$${values.length}`
  let keyset = ''
  if (cursor) {
    values.push(cursor.createdAt, cursor.id)
    keyset = `AND (b.created_at, b.id) ${comparison} ($${values.length - 1}::timestamptz, $${values.length})`
  }
  const { rows } = await dbRead().query<Blurt & { cursorAt?: string }>(
    `SELECT ${blurtColumns}, ${cursorColumn} FROM ${threadFrom}
     WHERE ${where} ${keyset}
     ORDER BY b.created_at ${direction}, b.id ${direction} LIMIT ${limit}`,
    values,
  )
  const items = rows.slice(0, size)
  const last = rows.length > size ? items.at(-1) : undefined
  const next = last?.cursorAt ? encodeCursor({ createdAt: last.cursorAt, id: last.id }) : null
  for (const item of items) {
    delete item.cursorAt
  }
  return { items, next }
}

const profileColumns = `p.user_id AS "userId", u.username, p.homepage, p.x, p.instagram,
  p.tiktok, p.youtube, p.github, p.linkedin, p.bio, p.avatar`

// Top-level blurts from accounts the user follows. The planner walks each followed user's
// (user_id, created_at DESC, id DESC) index.
const followedWhere = `b.parent_id IS NULL
  AND b.user_id IN (SELECT followed_user_id FROM follows WHERE user_id = $1)`

// Top-level blurts older than `before`, newest first, each with its latest replies.
// With `followedBy`, only blurts from accounts that user follows (the following feed).
export async function listFeed(
  before: Cursor | null = null,
  followedBy: number | null = null,
): Promise<Page<FeedItem>> {
  const page =
    followedBy === null
      ? await listPage('b.parent_id IS NULL AND b.deleted_at IS NULL', [], before, 'newest first')
      : await listPage(followedWhere, [followedBy], before, 'newest first')
  return { items: await withReplies(page.items), next: page.next }
}

// The latest few blurts from accounts the user follows, for the top of the everyone feed.
export async function listFollowedHighlights(userId: number): Promise<FeedItem[]> {
  const { items } = await listPage(
    followedWhere,
    [userId],
    null,
    'newest first',
    followedHighlightsLimit,
  )
  return withReplies(items)
}

// Adds each blurt's latest replies, oldest of those first.
async function withReplies(blurts: Blurt[]): Promise<FeedItem[]> {
  const { rows: replies } = await dbRead().query<Blurt>(
    `SELECT r.* FROM unnest($1::bigint[]) AS p(id) CROSS JOIN LATERAL (
       SELECT ${blurtColumns} FROM ${threadFrom}
       WHERE b.parent_id = p.id ORDER BY b.created_at DESC, b.id DESC LIMIT $2
     ) r ORDER BY r."createdAt", r.id`,
    [blurts.map((blurt) => blurt.id), feedRepliesPerBlurt],
  )
  return blurts.map((blurt) => ({
    ...blurt,
    replies: replies.filter((reply) => reply.parentId === blurt.id),
  }))
}

// Older than `before`, newest first, replies included.
export function listBlurtsByUserId(
  userId: number,
  before: Cursor | null = null,
): Promise<Page<Blurt>> {
  return listPage('b.user_id = $1', [userId], before, 'newest first')
}

export async function getBlurt(id: number): Promise<Blurt | undefined> {
  const { rows } = await db().query<Blurt>(
    `SELECT ${blurtColumns} FROM ${threadFrom} WHERE b.id = $1`,
    [id],
  )
  return rows[0]
}

// Direct replies after `after`, oldest first so the thread reads top to bottom.
export function listReplies(parentId: number, after: Cursor | null = null): Promise<Page<Blurt>> {
  return listPage('b.parent_id = $1', [parentId], after, 'oldest first')
}

// Closest blurts by meaning, excluding the blurt itself and its direct replies (shown anyway).
// Empty until the blurt's embedding has been computed.
export async function listRelatedBlurts(id: number): Promise<Blurt[]> {
  const { rows } = await dbRead().query<Blurt>(
    `WITH target AS (SELECT embedding FROM blurts WHERE id = $1 AND embedding IS NOT NULL)
     SELECT ${blurtColumns} FROM target t CROSS JOIN blurts b JOIN users u ON u.id = b.user_id
     WHERE b.id <> $1 AND b.parent_id IS DISTINCT FROM $1 AND b.embedding IS NOT NULL
       AND b.embedding <=> t.embedding < $3
     ORDER BY b.embedding <=> t.embedding LIMIT $2`,
    [id, relatedLimit, relatedMaxDistance],
  )
  return rows
}

// How many of the user's latest blurts (posts and replies alike) make up their taste.
const tasteBlurts = 20

// Top-level blurts close in meaning to what the user has blurted lately: the average of
// their latest embeddings. Leaves out their own blurts, blurts from accounts they follow
// (those are in the feed anyway) and `excludeIds` (already on the page). Empty for users
// with no embedded blurts yet.
export async function listSimilarToUser(
  userId: number,
  excludeIds: number[],
  limit: number,
): Promise<Blurt[]> {
  const { rows } = await dbRead().query<Blurt>(
    `WITH taste AS (
       SELECT avg(embedding) AS embedding FROM (
         SELECT embedding FROM blurts WHERE user_id = $1 AND embedding IS NOT NULL
         ORDER BY created_at DESC, id DESC LIMIT $2
       ) recent
     )
     SELECT ${blurtColumns} FROM taste t CROSS JOIN blurts b JOIN users u ON u.id = b.user_id
     WHERE t.embedding IS NOT NULL AND b.parent_id IS NULL AND b.embedding IS NOT NULL
       AND b.user_id <> $1
       AND b.user_id NOT IN (SELECT followed_user_id FROM follows WHERE user_id = $1)
       AND b.id <> ALL ($3::bigint[])
       AND b.embedding <=> t.embedding < $5
     ORDER BY b.embedding <=> t.embedding LIMIT $4`,
    [userId, tasteBlurts, excludeIds, limit, relatedMaxDistance],
  )
  return rows
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
const nearbyWhere = `b.parent_id IS NULL AND b.user_id <> $1 AND b.user_id IN (
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
export async function listNearbyForUser(
  userId: number,
  excludeIds: number[],
  limit: number,
): Promise<Blurt[]> {
  const { rows } = await dbRead().query<Blurt>(
    `SELECT ${blurtColumns} FROM blurts b JOIN users u ON u.id = b.user_id
     WHERE ${nearbyWhere}
       AND b.user_id NOT IN (SELECT followed_user_id FROM follows WHERE user_id = $1)
       AND b.id <> ALL ($3::bigint[])
     ORDER BY b.created_at DESC, b.id DESC LIMIT $4`,
    [userId, nearbyDiscoveryKm, excludeIds, limit],
  )
  return rows
}

// Returns the new blurt's id, or undefined if the user no longer exists
// (e.g. a still-valid token after a database reset).
export async function addBlurt(
  userId: number,
  text: string,
  parentId: number | null = null,
): Promise<number | undefined> {
  const { rows } = await db().query<{ id: number }>(
    'INSERT INTO blurts (user_id, text, parent_id) SELECT id, $2, $3 FROM users WHERE id = $1 RETURNING id',
    [userId, text, parentId],
  )
  return rows[0]?.id
}

// Deletes blurts, in one transaction. A blurt without replies goes for good. One with
// replies becomes a placeholder: text, embedding and author removed, so it refers to
// nobody, and the replies stay readable under "This blurt was deleted". A placeholder
// whose last reply is deleted goes too, and so on up the thread. Reports on the deleted
// blurts go with them. Account deletion (025) passes all of a user's blurts, with its own
// transaction's `client`; without one, this runs in a transaction of its own.
export async function deleteBlurts(
  ids: number[],
  client?: Pick<pg.PoolClient, 'query'>,
): Promise<void> {
  if (!client) {
    const own = await db().connect()
    try {
      await own.query('BEGIN')
      await deleteBlurts(ids, own)
      await own.query('COMMIT')
    } catch (error) {
      await own.query('ROLLBACK')
      throw error
    } finally {
      own.release()
    }
    return
  }
  // Locks the blurts first. A reply being posted to one of them holds a key-share lock on
  // it until it commits, so the reply is either in before this looks for replies (and the
  // blurt stays as a placeholder) or waits and then finds its parent gone or deleted.
  await client.query('SELECT 1 FROM blurts WHERE id = ANY($1::bigint[]) FOR UPDATE', [ids])
  await client.query('DELETE FROM reports WHERE blurt_id = ANY($1::bigint[])', [ids])
  await client.query('DELETE FROM likes WHERE blurt_id = ANY($1::bigint[])', [ids])
  await client.query(
    `UPDATE blurts SET deleted_at = now(), user_id = NULL, text = NULL, embedding = NULL,
       like_count = 0
     WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
    [ids],
  )
  // Then removes placeholders left without replies, from the leaves up the thread.
  let candidates = ids
  while (candidates.length > 0) {
    const { rows } = await client.query<{ parentId: number | null }>(
      `DELETE FROM blurts b WHERE b.id = ANY($1::bigint[]) AND b.deleted_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM blurts r WHERE r.parent_id = b.id)
       RETURNING b.parent_id AS "parentId"`,
      [candidates],
    )
    candidates = rows.flatMap((row) => (row.parentId === null ? [] : [row.parentId]))
  }
}

// Deletes the account and everything that refers to it, in one transaction. The user's
// blurts go through deleteBlurts (one with replies from others stays as an authorless
// placeholder). Deleting the users row then cascades to the profile (avatar, location),
// sessions, follows both ways, the user's own invite codes and the reports they made. The
// likes they gave are taken off each blurt's count and deleted before that. The
// code they signed up with stays used (used_at) with used_by_user_id set NULL. Their
// waitlist entry goes. The username is retired for good (retired_usernames), so nobody
// can take it and pass for them. signup_counter is left alone: it counts sign-ups, so a
// deletion doesn't free a slot. Returns the ids of the sessions it ended (for
// endDeletedAccountSessions), or undefined if the user doesn't exist (any more).
export async function deleteAccount(userId: number): Promise<string[] | undefined> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    // Locks the user first: posting, following or reporting as them takes a key-share lock
    // on this row, so those finish before this, or wait and then find no user.
    const { rows } = await client.query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    )
    const user = rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return undefined
    }
    // Locks the user's blurts and the blurts they liked, in id order, so two accounts
    // deleted at once that liked each other's blurts can't deadlock.
    await client.query(
      `SELECT 1 FROM blurts WHERE user_id = $1
         OR id IN (SELECT blurt_id FROM likes WHERE user_id = $1)
       ORDER BY id FOR UPDATE`,
      [userId],
    )
    await client.query(
      `UPDATE blurts b SET like_count = b.like_count - 1
       FROM likes l WHERE l.blurt_id = b.id AND l.user_id = $1`,
      [userId],
    )
    await client.query('DELETE FROM likes WHERE user_id = $1', [userId])
    const blurts = await client.query<{ id: number }>('SELECT id FROM blurts WHERE user_id = $1', [
      userId,
    ])
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
    await client.query('DELETE FROM users WHERE id = $1', [userId])
    await client.query('COMMIT')
    return sessions.rows.map((session) => session.id)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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
    `INSERT INTO reports (user_id, blurt_id, reason) SELECT id, $2, $3 FROM users WHERE id = $1
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
  const { rows: blurts } = await db().query<Blurt>(
    `SELECT ${blurtColumns} FROM ${threadFrom}
     JOIN (SELECT blurt_id, min(created_at) AS first FROM reports WHERE dismissed_at IS NULL
           GROUP BY blurt_id) o ON o.blurt_id = b.id
     ORDER BY o.first, b.id LIMIT $1`,
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
       youtube = $6, github = $7, linkedin = $8, bio = $9, updated_at = now()
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
    ],
  )
  if (!rows[0]) {
    throw new Error(`Missing profile for user ${userId}`)
  }
  return rows[0]
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
    `INSERT INTO follows (user_id, followed_user_id) SELECT id, $2 FROM users WHERE id = $1
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

// Sets `viewerLikes` on the blurts the viewer likes, a feed item's replies included: one
// query for a whole page. Does nothing for anonymous viewers.
export async function markViewerLikes(
  viewerId: number | null,
  blurts: (Blurt | FeedItem | null)[],
): Promise<void> {
  const all = blurts.flatMap((blurt) =>
    blurt === null ? [] : [blurt, ...('replies' in blurt ? blurt.replies : [])],
  )
  if (viewerId === null || all.length === 0) {
    return
  }
  const { rows } = await dbRead().query<{ blurtId: number }>(
    'SELECT blurt_id AS "blurtId" FROM likes WHERE user_id = $1 AND blurt_id = ANY($2::bigint[])',
    [viewerId, all.map((blurt) => blurt.id)],
  )
  const liked = new Set(rows.map((row) => row.blurtId))
  for (const blurt of all) {
    blurt.viewerLikes = liked.has(blurt.id)
  }
}

export type LikeState = { blurtId: number; likeCount: number; viewerLikes: boolean }

// Likes (or with `likes` false, unlikes) a blurt. Liking twice, or unliking a blurt you
// don't like, changes nothing. The blurt's row is locked first, so concurrent likes and
// unlikes of one blurt queue: each sees the count the one before it left, and none is lost.
// Deleted blurts and placeholders can't be liked. deleteBlurts takes the same lock, so a
// like either lands first (and goes with the blurt) or waits and then finds it gone.
// Returns the new state, 'not-found' for no such blurt, or 'no-user' if the user no longer
// exists (e.g. a still-valid token after a database reset).
export async function setLike(
  userId: number,
  blurtId: number,
  likes: boolean,
): Promise<LikeState | 'not-found' | 'no-user'> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    // The user, then the blurt: the order deleteAccount locks them in.
    const user = await client.query('SELECT 1 FROM users WHERE id = $1 FOR KEY SHARE', [userId])
    if (user.rowCount === 0) {
      await client.query('ROLLBACK')
      return 'no-user'
    }
    const blurt = await client.query<{ likeCount: number }>(
      `SELECT like_count AS "likeCount" FROM blurts WHERE id = $1 AND deleted_at IS NULL
       FOR NO KEY UPDATE`,
      [blurtId],
    )
    if (blurt.rowCount === 0) {
      await client.query('ROLLBACK')
      return 'not-found'
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
    let likeCount = blurt.rows[0].likeCount
    if (changed.rowCount === 1) {
      const updated = await client.query<{ likeCount: number }>(
        `UPDATE blurts SET like_count = like_count + $2 WHERE id = $1
         RETURNING like_count AS "likeCount"`,
        [blurtId, likes ? 1 : -1],
      )
      likeCount = updated.rows[0].likeCount
    }
    await client.query('COMMIT')
    return { blurtId, likeCount, viewerLikes: likes }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
