import { db } from '../db.ts'

export type Blurt = {
  id: number
  username: string
  text: string
  createdAt: Date
  parentId: number | null
  replyCount: number
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
}

export type UserProfileInput = Omit<UserProfile, 'userId' | 'username'>

const pageSize = 100
const feedRepliesPerBlurt = 2
const relatedLimit = 5
// Cosine distance (0 = same meaning, 1 = unrelated). With all-MiniLM-L6-v2, short blurts on
// the same topic land around 0.6-0.7 and unrelated ones above 0.8.
const relatedMaxDistance = 0.75

const blurtColumns = `b.id, u.username, b.text, b.created_at AS "createdAt", b.parent_id AS "parentId",
  (SELECT count(*) FROM blurts r WHERE r.parent_id = b.id)::int AS "replyCount"`

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
    typeof value === 'string'
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

// Keyset pagination on (created_at, id), never OFFSET, so pages stay fast and don't shift
// as new blurts arrive. The indexes on (..., created_at DESC, id DESC) serve both orders.
// Fetches one extra row to know whether there is a next page.
async function listPage(
  where: string,
  params: unknown[],
  cursor: Cursor | null,
  order: 'newest first' | 'oldest first',
): Promise<Page<Blurt>> {
  const [direction, comparison] = order === 'newest first' ? ['DESC', '<'] : ['ASC', '>']
  const values = [...params, pageSize + 1]
  const limit = `$${values.length}`
  let keyset = ''
  if (cursor) {
    values.push(cursor.createdAt, cursor.id)
    keyset = `AND (b.created_at, b.id) ${comparison} ($${values.length - 1}::timestamptz, $${values.length})`
  }
  const { rows } = await db().query<Blurt & { cursorAt?: string }>(
    `SELECT ${blurtColumns}, ${cursorColumn} FROM blurts b JOIN users u ON u.id = b.user_id
     WHERE ${where} ${keyset}
     ORDER BY b.created_at ${direction}, b.id ${direction} LIMIT ${limit}`,
    values,
  )
  const items = rows.slice(0, pageSize)
  const last = rows.length > pageSize ? items.at(-1) : undefined
  const next = last?.cursorAt ? encodeCursor({ createdAt: last.cursorAt, id: last.id }) : null
  for (const item of items) {
    delete item.cursorAt
  }
  return { items, next }
}

const profileColumns = `p.user_id AS "userId", u.username, p.homepage, p.x, p.instagram,
  p.tiktok, p.youtube, p.github, p.linkedin, p.bio`

// Top-level blurts older than `before`, newest first, each with its latest replies.
export async function listFeed(before: Cursor | null = null): Promise<Page<FeedItem>> {
  const { items: blurts, next } = await listPage('b.parent_id IS NULL', [], before, 'newest first')
  const { rows: replies } = await db().query<Blurt>(
    `SELECT r.* FROM unnest($1::bigint[]) AS p(id) CROSS JOIN LATERAL (
       SELECT ${blurtColumns} FROM blurts b JOIN users u ON u.id = b.user_id
       WHERE b.parent_id = p.id ORDER BY b.created_at DESC, b.id DESC LIMIT $2
     ) r ORDER BY r."createdAt", r.id`,
    [blurts.map((blurt) => blurt.id), feedRepliesPerBlurt],
  )
  return {
    items: blurts.map((blurt) => ({
      ...blurt,
      replies: replies.filter((reply) => reply.parentId === blurt.id),
    })),
    next,
  }
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
    `SELECT ${blurtColumns} FROM blurts b JOIN users u ON u.id = b.user_id WHERE b.id = $1`,
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
  const { rows } = await db().query<Blurt>(
    `WITH target AS (SELECT embedding FROM blurts WHERE id = $1 AND embedding IS NOT NULL)
     SELECT ${blurtColumns} FROM target t CROSS JOIN blurts b JOIN users u ON u.id = b.user_id
     WHERE b.id <> $1 AND b.parent_id IS DISTINCT FROM $1 AND b.embedding IS NOT NULL
       AND b.embedding <=> t.embedding < $3
     ORDER BY b.embedding <=> t.embedding LIMIT $2`,
    [id, relatedLimit, relatedMaxDistance],
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

// Creates the user and an empty profile in one statement.
// Returns undefined if the username is already taken.
export async function addUser(username: string, passwordHash: string): Promise<User | undefined> {
  const { rows } = await db().query<User>(
    `WITH new_user AS (
       INSERT INTO users (username, password_hash) VALUES ($1, $2)
       ON CONFLICT DO NOTHING -- username taken, in any letter case
       RETURNING id, username, password_hash
     ), new_profile AS (
       INSERT INTO user_profiles (user_id) SELECT id FROM new_user
     )
     SELECT id, username, password_hash AS "passwordHash" FROM new_user`,
    [username, passwordHash],
  )
  return rows[0]
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
