import { createHash, randomBytes } from 'node:crypto'
import { randomAvatar } from '../../avatar.ts'
import { db } from '../../db.ts'
import type { AuthenticatedUser } from '../../middleware/auth.ts'

// Bots, their owners, their API tokens, and "Hide bots" (tickets/031-bots.md,
// db/migrations/*_bots.sql). A bot is an account without a password: its owners manage it
// from their own accounts (/settings/bots, src/routes/bots.ts) and it blurts through
// /api/v1/ with a token (src/routes/api-v1.ts).

export const maxBotsPerOwner = 10
export const maxTokensPerBot = 5
export const tokenNameMaxLength = 50

// The prefix lets secret scanners recognise a leaked token.
const tokenPrefix = 'blurt_'

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export type OwnedBot = { id: number; username: string; owners: string[] }

// A new bot owned by `ownerId`, with a random avatar like a sign-up. Bots take no sign-up
// slot and no invite: a person makes them. 'taken' if the username is taken or retired,
// 'full' at maxBotsPerOwner.
export async function createBot(
  ownerId: number,
  username: string,
): Promise<AuthenticatedUser | 'taken' | 'full'> {
  const { rows } = await db().query<{ id: number | null; username: string | null; full: boolean }>(
    `WITH owner AS (
       SELECT (SELECT count(*) FROM bot_owners WHERE user_id = $1) >= $4 AS full
       FROM users WHERE id = $1 AND deleted_at IS NULL AND NOT is_bot FOR UPDATE
     ), bot AS (
       INSERT INTO users (username, is_bot) SELECT $2::text, true FROM owner
       WHERE NOT owner.full
         AND NOT EXISTS (SELECT 1 FROM retired_usernames WHERE username = lower($2))
       ON CONFLICT DO NOTHING -- username taken in any letter case
       RETURNING id, username
     ), profile AS (
       INSERT INTO user_profiles (user_id, avatar) SELECT id, $3::jsonb FROM bot
     ), owned AS (
       INSERT INTO bot_owners (bot_user_id, user_id) SELECT id, $1 FROM bot
     )
     SELECT bot.id, bot.username, coalesce(owner.full, true) AS full
     FROM (SELECT 1) one LEFT JOIN owner ON true LEFT JOIN bot ON true`,
    [ownerId, username, JSON.stringify(randomAvatar()), maxBotsPerOwner],
  )
  const row = rows[0]
  if (row.id !== null && row.username !== null) {
    return { id: row.id, username: row.username }
  }
  return row.full ? 'full' : 'taken'
}

const ownersColumn = `ARRAY(
  SELECT ou.username FROM bot_owners o JOIN users ou ON ou.id = o.user_id
  WHERE o.bot_user_id = b.id AND ou.deleted_at IS NULL ORDER BY o.created_at, ou.username
) AS owners`

export async function listOwnedBots(ownerId: number): Promise<OwnedBot[]> {
  const { rows } = await db().query<OwnedBot>(
    `SELECT b.id, b.username, ${ownersColumn}
     FROM bot_owners mine JOIN users b ON b.id = mine.bot_user_id AND b.deleted_at IS NULL
     WHERE mine.user_id = $1 ORDER BY lower(b.username)`,
    [ownerId],
  )
  return rows
}

// The bot by its username, if `userId` owns it (or `asAdmin`): what every management route
// checks first.
export async function getOwnedBot(
  userId: number,
  username: string,
  asAdmin = false,
): Promise<OwnedBot | undefined> {
  const { rows } = await db().query<OwnedBot>(
    `SELECT b.id, b.username, ${ownersColumn} FROM users b
     WHERE lower(b.username) = lower($2) AND b.is_bot AND b.deleted_at IS NULL
       AND ($3 OR EXISTS (SELECT 1 FROM bot_owners o WHERE o.bot_user_id = b.id AND o.user_id = $1))`,
    [userId, username, asAdmin],
  )
  return rows[0]
}

// The owners of a bot, by username, for its profile.
export async function getBotOwners(botId: number): Promise<string[]> {
  const { rows } = await db().query<{ owners: string[] }>(
    `SELECT ${ownersColumn} FROM users b WHERE b.id = $1`,
    [botId],
  )
  return rows[0]?.owners ?? []
}

// Shares a bot with another person. 'no-user' when there is no such person (bots can't own
// bots). Sharing twice does nothing.
export async function addOwner(botId: number, username: string): Promise<'added' | 'no-user'> {
  const { rows } = await db().query<{ found: boolean }>(
    `WITH person AS (
       SELECT id FROM users WHERE lower(username) = lower($2) AND NOT is_bot AND deleted_at IS NULL
     ), added AS (
       INSERT INTO bot_owners (bot_user_id, user_id) SELECT $1, id FROM person ON CONFLICT DO NOTHING
     )
     SELECT EXISTS (SELECT 1 FROM person) AS found`,
    [botId, username],
  )
  return rows[0].found ? 'added' : 'no-user'
}

// Takes an owner off a bot (leaving it, or taking a co-owner off). 'last' when they are its
// only owner: a bot always has one, so they delete it instead. Handing a bot over is adding
// the new owner and then leaving.
export async function removeOwner(
  botId: number,
  username: string,
): Promise<'removed' | 'not-owner' | 'last'> {
  return db()
    .query<{ result: 'removed' | 'not-owner' | 'last' }>(
      `WITH locked AS (SELECT id FROM users WHERE id = $1 FOR UPDATE),
       target AS (
         SELECT o.user_id FROM bot_owners o JOIN users u ON u.id = o.user_id
         WHERE o.bot_user_id = $1 AND lower(u.username) = lower($2)
       ), others AS (
         SELECT count(*) AS n FROM bot_owners
         WHERE bot_user_id = $1 AND user_id NOT IN (SELECT user_id FROM target)
       ), removed AS (
         DELETE FROM bot_owners WHERE bot_user_id = $1
           AND user_id IN (SELECT user_id FROM target) AND (SELECT n FROM others) > 0
         RETURNING 1
       )
       SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not-owner'
         WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed' ELSE 'last' END AS result
       FROM locked`,
      [botId, username],
    )
    .then(({ rows }) => rows[0]?.result ?? 'not-owner')
}

// Admins: makes `username` the bot's only owner. 'no-user' when there is no such person.
export async function setOwner(botId: number, username: string): Promise<'set' | 'no-user'> {
  const { rows } = await db().query<{ found: boolean }>(
    `WITH person AS (
       SELECT id FROM users WHERE lower(username) = lower($2) AND NOT is_bot AND deleted_at IS NULL
     ), cleared AS (
       DELETE FROM bot_owners WHERE bot_user_id = $1 AND EXISTS (SELECT 1 FROM person)
         AND user_id NOT IN (SELECT id FROM person)
     ), added AS (
       INSERT INTO bot_owners (bot_user_id, user_id) SELECT $1, id FROM person ON CONFLICT DO NOTHING
     )
     SELECT EXISTS (SELECT 1 FROM person) AS found`,
    [botId, username],
  )
  return rows[0].found ? 'set' : 'no-user'
}

// When an owner's account is deleted (deleteAccount): their bots that nobody else owns.
export async function listSoleOwnedBots(ownerId: number): Promise<number[]> {
  const { rows } = await db().query<{ id: number }>(
    `SELECT o.bot_user_id AS id FROM bot_owners o
     WHERE o.user_id = $1
       AND NOT EXISTS (SELECT 1 FROM bot_owners x WHERE x.bot_user_id = o.bot_user_id AND x.user_id <> $1)`,
    [ownerId],
  )
  return rows.map((row) => row.id)
}

export type ApiToken = { id: number; name: string; createdAt: Date; lastUsedAt: Date | null }

export async function listTokens(botId: number): Promise<ApiToken[]> {
  const { rows } = await db().query<ApiToken>(
    `SELECT id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt"
     FROM api_tokens WHERE user_id = $1 ORDER BY id`,
    [botId],
  )
  return rows
}

// A new token for a bot: the token itself is in the result only, never stored. 'full' at
// maxTokensPerBot.
export async function createToken(
  botId: number,
  name: string,
): Promise<(ApiToken & { token: string }) | 'full'> {
  const token = tokenPrefix + randomBytes(32).toString('base64url')
  // The bot's row lock makes two tokens minted at once count each other.
  const { rows } = await db().query<ApiToken>(
    `WITH bot AS (
       SELECT id FROM users WHERE id = $1 AND is_bot AND deleted_at IS NULL FOR UPDATE
     )
     INSERT INTO api_tokens (user_id, name, token_hash)
     SELECT id, $2, $3 FROM bot WHERE (SELECT count(*) FROM api_tokens WHERE user_id = $1) < $4
     RETURNING id, name, created_at AS "createdAt", last_used_at AS "lastUsedAt"`,
    [botId, name, hashToken(token), maxTokensPerBot],
  )
  return rows[0] ? { ...rows[0], token } : 'full'
}

// False when it isn't one of the bot's tokens.
export async function revokeToken(botId: number, id: number): Promise<boolean> {
  const { rowCount } = await db().query('DELETE FROM api_tokens WHERE user_id = $1 AND id = $2', [
    botId,
    id,
  ])
  return rowCount === 1
}

// The bot a bearer token belongs to: undefined for an unknown or revoked token, and for a
// deleted bot. last_used_at is written at most once a minute, so a busy bot doesn't write on
// every request.
export async function userForToken(token: string): Promise<AuthenticatedUser | undefined> {
  if (!token.startsWith(tokenPrefix) || token.length > 100) {
    return undefined
  }
  const { rows } = await db().query<AuthenticatedUser>(
    `WITH used AS (
       UPDATE api_tokens SET last_used_at = now()
       WHERE token_hash = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
     )
     SELECT u.id, u.username FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND u.is_bot AND u.deleted_at IS NULL`,
    [hashToken(token)],
  )
  return rows[0]
}

export async function getHideBots(userId: number): Promise<boolean> {
  const { rows } = await db().query<{ hideBots: boolean }>(
    'SELECT hide_bots AS "hideBots" FROM user_profiles WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.hideBots ?? false
}

// False when the user no longer exists.
export async function setHideBots(userId: number, hide: boolean): Promise<boolean> {
  const { rowCount } = await db().query(
    'UPDATE user_profiles SET hide_bots = $2, updated_at = now() WHERE user_id = $1',
    [userId, hide],
  )
  return rowCount === 1
}

// SQL to AND onto a list's WHERE (about `b`, the shown blurt, see selectShown): leaves out
// blurts by bots `viewerId` hides. Nothing for anonymous viewers. The id is a number, so it
// is safe to write into the SQL.
export function withoutHiddenBots(viewerId: number | null): string {
  return viewerId === null || !Number.isSafeInteger(viewerId)
    ? 'true'
    : `NOT ${hiddenBot('b.user_id', String(viewerId))}`
}

// SQL: true when the account `actor` (an expression for a users.id) is a bot that the user
// `viewer` (an expression for a users.id) hides: they have "Hide bots" on and don't follow
// it. Following wins, since following is a choice the user made.
export function hiddenBot(actor: string, viewer: string): string {
  return `EXISTS (
    SELECT 1 FROM users hb JOIN user_profiles hv ON hv.user_id = ${viewer}
    WHERE hb.id = ${actor} AND hb.is_bot AND hv.hide_bots
      AND NOT EXISTS (SELECT 1 FROM follows hf WHERE hf.user_id = ${viewer} AND hf.followed_user_id = hb.id)
  )`
}
