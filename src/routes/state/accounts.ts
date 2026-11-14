import { randomAvatar } from '../../avatar.ts'
import { db } from '../../db.ts'
import { deleteBlurts, inTransaction, plainReblurt } from './blurts.ts'
import { invitesPerUser, mintInviteCodes } from './signup.ts'

export type User = {
  id: number
  username: string
  passwordHash: string
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

export async function getUserByUsername(username: string): Promise<User | undefined> {
  const { rows } = await db().query<User>(
    `SELECT id, username, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)`,
    [username],
  )
  return rows[0]
}
