import type pg from 'pg'
import { inTransaction, liveUser, plainReblurt } from './blurts.ts'
import { hiddenBot } from './bots.ts'

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
// `onNotified` gets the author's id once a reblurt that notified them is saved (addBlurt).
export async function setReblurt(
  userId: number,
  blurtId: number,
  reblurts: boolean,
  onNotified?: (userIds: number[]) => void,
): Promise<ReblurtState | 'not-found' | 'no-user' | 'own'> {
  let notified: number[] = []
  const state = await inTransaction(async (client) => {
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
      const notification = await (reblurts
        ? client.query(
            `INSERT INTO notifications (user_id, kind, actor_user_id, blurt_id)
             SELECT $1, 'reblurt', $2, $3 FROM user_profiles WHERE user_id = $1 AND notify_reblurts
               AND NOT ${hiddenBot('$2::bigint', '$1::bigint')}
             ON CONFLICT DO NOTHING`,
            [locked.authorId, userId, blurtId],
          )
        : client.query(
            `DELETE FROM notifications
             WHERE user_id = $1 AND kind = 'reblurt' AND actor_user_id = $2 AND blurt_id = $3`,
            [locked.authorId, userId, blurtId],
          ))
      notified = reblurts && notification.rowCount === 1 ? [locked.authorId] : []
    }
    const reblurtCount =
      changed.rowCount === 1
        ? await bumpStat(client, blurtId, 'reblurt_count', reblurts ? 1 : -1)
        : await readStat(client, blurtId, 'reblurt_count')
    return { blurtId, reblurtCount, viewerReblurted: reblurts }
  })
  if (notified.length > 0) {
    onNotified?.(notified)
  }
  return state
}
