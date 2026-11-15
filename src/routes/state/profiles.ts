import type { Avatar } from '../../avatar.ts'
import type { CardColorId } from '../../card-colors.ts'
import { db, dbRead } from '../../db.ts'
import type { GeoPoint } from '../../geo.ts'
import { avatarColumn, type Page } from './blurts.ts'
import type { ThemeId } from '../../themes.ts'

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

const profileColumns = `p.user_id AS "userId", u.username, p.homepage, p.x, p.instagram,
  p.tiktok, p.youtube, p.github, p.linkedin, p.bio, ${avatarColumn('p')} AS avatar,
  p.card_color AS "cardColor"`

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

// A user found by /search.
export type UserMatch = { username: string; avatar: Avatar }

const userSearchLimit = 20

// Usernames containing `query`, ignoring case: those starting with it first (the exact
// name first of all, as the shortest), then the rest, alphabetically. strpos, not LIKE,
// so `_` and `%` are plain characters. A sequential scan of users, which stays small
// (signup_counter's hard limit); a trigram index would serve substrings if it grows.
export async function searchUsers(query: string): Promise<UserMatch[]> {
  const { rows } = await dbRead().query<UserMatch>(
    `SELECT u.username, ${avatarColumn('p')} AS avatar FROM users u JOIN user_profiles p ON p.user_id = u.id
     WHERE strpos(lower(u.username), lower($1)) > 0
     ORDER BY strpos(lower(u.username), lower($1)) = 1 DESC, length(u.username),
       lower(u.username)
     LIMIT $2`,
    [query, userSearchLimit],
  )
  return rows
}

// A row of /people. Counts are blurts and replies with text (not plain reblurts, not
// deleted ones). `lastBlurtAt` is null for someone who has never blurted.
export type Person = {
  username: string
  avatar: Avatar
  bio: string
  joinedAt: Date
  blurtCount: number
  followerCount: number
  lastBlurtAt: Date | null
}

const peoplePageSize = 50

const peopleCursorPattern = /^[a-z0-9_]{1,40}$/

// From the query string: null when there is no cursor, undefined when it is malformed.
// The cursor is the last username of the previous page, in lower case (they are unique
// regardless of case, see users_username_lower_key).
export function parsePeopleCursor(value: unknown): string | null | undefined {
  if (value === undefined) {
    return null
  }
  return typeof value === 'string' && peopleCursorPattern.test(value) ? value : undefined
}

// Everyone with a live account, alphabetically, keyset-paged on lower(username) so it
// walks users_username_lower_key and never uses OFFSET. The counts are subqueries run only
// for the page's rows: blurts_user_id_created_at_idx and follows_followed_user_id_idx
// serve them.
export async function listPeople(after: string | null): Promise<Page<Person>> {
  const { rows } = await dbRead().query<Person>(
    `SELECT u.username, ${avatarColumn('p')} AS avatar, p.bio, u.created_at AS "joinedAt",
       (SELECT count(*)::int FROM blurts b
         WHERE b.user_id = u.id AND b.deleted_at IS NULL AND b.text IS NOT NULL) AS "blurtCount",
       (SELECT count(*)::int FROM follows f WHERE f.followed_user_id = u.id) AS "followerCount",
       (SELECT max(b.created_at) FROM blurts b
         WHERE b.user_id = u.id AND b.deleted_at IS NULL AND b.text IS NOT NULL) AS "lastBlurtAt"
     FROM users u JOIN user_profiles p ON p.user_id = u.id
     WHERE u.deleted_at IS NULL AND ($1::text IS NULL OR lower(u.username) > $1)
     ORDER BY lower(u.username)
     LIMIT $2`,
    [after, peoplePageSize + 1],
  )
  const items = rows.slice(0, peoplePageSize)
  const next = rows.length > peoplePageSize ? items[items.length - 1].username.toLowerCase() : null
  return { items, next }
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

// Just the bio (a bot's, from /settings/bots/:username). False when the user no longer exists.
export async function setBio(userId: number, bio: string): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET bio = $2, updated_at = now() WHERE user_id = $1',
    [userId, bio],
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

// The "Use JavaScript" setting (src/javascript.ts). False when the user no longer exists.
export async function setJavaScript(userId: number, javascript: boolean): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET javascript = $2, updated_at = now() WHERE user_id = $1',
    [userId, javascript],
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

// Sets the user's profile picture (a drawing from src/picture.ts, encodeShapes), or removes
// it (null). A new one gets a new version, so its URLs change. False if the user has no
// profile (e.g. a still-valid token after a database reset). `cut`, when given, sets where
// its mouth opens in the same update.
export async function setProfilePicture(
  userId: number,
  shapes: Buffer | null,
  cut?: number,
): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE user_profiles SET picture = $2::bytea, updated_at = now(),
       picture_version = picture_version + CASE WHEN $2::bytea IS NULL THEN 0 ELSE 1 END,
       picture_cut = COALESCE($3::smallint, picture_cut)
     WHERE user_id = $1`,
    [userId, shapes, cut ?? null],
  )
  return rowCount === 1
}

// Where the profile picture is cut apart (percent from the top, already checked against
// minPictureCut and maxPictureCut). False if the user has no profile.
export async function setPictureCut(userId: number, cut: number): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET picture_cut = $2, updated_at = now() WHERE user_id = $1',
    [userId, cut],
  )
  return rowCount === 1
}

// The stored drawing of a user's profile picture, only if `version` is the current one and
// the account is live. Asked from the replica first; right after an upload the picture may
// only be on the primary yet.
export async function getProfilePicture(
  userId: number,
  version: number,
): Promise<Buffer | undefined> {
  const sql = `SELECT p.picture FROM user_profiles p JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1 AND p.picture_version = $2 AND p.picture IS NOT NULL
       AND u.deleted_at IS NULL`
  for (const pool of [dbRead(), db()]) {
    const { rows } = await pool.query<{ picture: Buffer }>(sql, [userId, version])
    if (rows[0]) {
      return rows[0].picture
    }
  }
  return undefined
}
