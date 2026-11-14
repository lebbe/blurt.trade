import { db } from '../../db.ts'

// Web Push subscriptions (push_subscriptions, src/push.ts): one per browser that asked for
// notifications, tied to the login it was made in. All reads go to the primary: the edit
// page shows what was just saved, and the pushes decide writes (pushed_at).

export type PushSubscription = { endpoint: string; p256dh: string; auth: string }

// Saves a browser's subscription for this user and session. The same browser asking
// again (or after someone else logged in on it) takes the row over: an endpoint is one
// browser, which notifies one user. False when the session is gone (logged out meanwhile).
export async function savePushSubscription(
  userId: number,
  sessionId: string,
  { endpoint, p256dh, auth }: PushSubscription,
): Promise<boolean> {
  const { rowCount } = await db().query(
    `INSERT INTO push_subscriptions (endpoint, user_id, session_id, p256dh, auth)
     SELECT $1, $2, s.id, $4, $5 FROM sessions s
     WHERE s.id = $3 AND s.user_id = $2 AND s.revoked_at IS NULL
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id,
         p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, created_at = now(), pushed_at = NULL`,
    [endpoint, userId, sessionId, p256dh, auth],
  )
  return rowCount === 1
}

// Only the user's own: an endpoint someone else registered stays.
export async function deletePushSubscription(userId: number, endpoint: string): Promise<void> {
  await db().query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
    userId,
    endpoint,
  ])
}

// After the push service said the subscription is gone (404 or 410).
export async function forgetPushEndpoint(endpoint: string): Promise<void> {
  await db().query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
}

// The endpoints this login has, for the edit page's "Notify me on this device" button,
// which compares them with the browser's own (a browser has at most one).
export async function listSessionPushEndpoints(sessionId: string): Promise<string[]> {
  const { rows } = await db().query<{ endpoint: string }>(
    'SELECT endpoint FROM push_subscriptions WHERE session_id = $1 ORDER BY created_at',
    [sessionId],
  )
  return rows.map((row) => row.endpoint)
}

// Claims the user's devices that weren't pushed to in the last `intervalSeconds`, marking
// them pushed now, and says how long until the others may be pushed again (null: none
// waiting). Atomic per row, so two instances can't both push to the same device.
export async function claimPushEndpoints(
  userId: number,
  intervalSeconds: number,
): Promise<{ endpoints: string[]; waitSeconds: number | null }> {
  const { rows } = await db().query<{ endpoints: string[] | null; wait: number | null }>(
    `WITH claimed AS (
       UPDATE push_subscriptions SET pushed_at = now()
       WHERE user_id = $1 AND (pushed_at IS NULL OR pushed_at <= now() - $2 * interval '1 second')
         -- A logged-out session's row stays until the hourly cleanup deletes it (and this
         -- with it); it gets no pushes meanwhile.
         AND EXISTS (
           SELECT 1 FROM sessions s WHERE s.id = session_id AND s.revoked_at IS NULL
         )
       RETURNING endpoint
     )
     SELECT (SELECT array_agg(endpoint) FROM claimed) AS endpoints,
       (SELECT extract(epoch FROM min(pushed_at) + $2 * interval '1 second' - now())::float8
        FROM push_subscriptions
        WHERE user_id = $1 AND pushed_at > now() - $2 * interval '1 second') AS wait`,
    [userId, intervalSeconds],
  )
  return { endpoints: rows[0]?.endpoints ?? [], waitSeconds: rows[0]?.wait ?? null }
}

// All of the user's devices with notifications on (the edit page's "Stop on all devices").
export async function countPushDevices(userId: number): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    'SELECT count(*)::int AS count FROM push_subscriptions WHERE user_id = $1',
    [userId],
  )
  return rows[0]?.count ?? 0
}

export async function deleteAllPushSubscriptions(userId: number): Promise<void> {
  await db().query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId])
}
