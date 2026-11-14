import type { Avatar } from '../../avatar.ts'
import { db, dbRead } from '../../db.ts'
import { avatarColumn, type Cursor, encodeCursor, type Page, pageSize } from './blurts.ts'

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
       (SELECT ${avatarColumn('a')} FROM user_profiles a WHERE a.user_id = au.id) AS avatar,
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
  return countUnreadFromPrimary(userId)
}

// Like countUnreadNotifications, but from the primary: right after a write (ours, or one
// another instance told us about, src/events.ts).
export async function countUnreadFromPrimary(userId: number): Promise<number> {
  const { rows } = await db().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM (
       SELECT 1 FROM notifications WHERE user_id = $1 AND read_at IS NULL LIMIT ${unreadCap}
     ) unread`,
    [userId],
  )
  return rows[0]?.count ?? 0
}

// Visiting a blurt reads the viewer's unread notifications about it: the blurt a
// notification links to (a reply, a quote, a followed blurt, or their own reblurted blurt),
// and the blurt that reply or quote answers. Returns the new unread count if any were
// marked, else undefined. Callers skip it when the viewer has no unread notifications (the
// count is on every page already), so most visits cost nothing; a visit that matches
// nothing writes nothing. Each notification is marked once, so writes follow notifications,
// not page views.
export async function markNotificationsReadForBlurt(
  userId: number,
  blurtId: number,
): Promise<number | undefined> {
  const { rowCount } = await db().query(
    `UPDATE notifications n SET read_at = now()
     WHERE n.user_id = $1 AND n.read_at IS NULL AND (
       n.blurt_id = $2 OR EXISTS (
         SELECT 1 FROM blurts b
         WHERE b.id = n.blurt_id AND (b.parent_id = $2 OR b.reblurt_of_id = $2)
       )
     )`,
    [userId, blurtId],
  )
  return rowCount ? countUnreadFromPrimary(userId) : undefined
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
