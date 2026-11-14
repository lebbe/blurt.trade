import { db } from '../../db.ts'
import { liveUser } from './blurts.ts'

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
