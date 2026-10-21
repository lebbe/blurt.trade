-- Up Migration

-- Notifications (ticket 5): a row per thing that happened to a user, created at write time
-- (addBlurt, setReblurt in src/routes/state.ts) and only if the recipient has that kind
-- switched on, so reading the list and the unread count stays cheap. See "Notifications" in
-- docs/routes.md.
--
--   followed_blurt  user_id follows actor_user_id, who posted the top-level blurt blurt_id
--   reply           actor_user_id replied (blurt_id) to a blurt of user_id
--   reblurt         actor_user_id reblurted blurt_id, a blurt of user_id (plain reblurt)
--   quote           actor_user_id quoted a blurt of user_id; blurt_id is the quote
--
-- The settings are one switch per kind; reblurt and quote share notify_reblurts. Defaults:
-- replies and reblurts on, blurts from followed accounts off (it gets noisy). They live on
-- user_profiles, which is deleted with the account.
ALTER TABLE user_profiles
  ADD COLUMN notify_followed_blurts boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_replies boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_reblurts boolean NOT NULL DEFAULT true;

CREATE TABLE notifications (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('followed_blurt', 'reply', 'reblurt', 'quote')),
  actor_user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blurt_id      bigint NOT NULL REFERENCES blurts (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  -- Nobody is notified about their own actions.
  CONSTRAINT notifications_not_self CHECK (user_id <> actor_user_id),
  -- Reblurting twice is one reblurt; un-reblurting removes the row (setReblurt).
  CONSTRAINT notifications_once UNIQUE (user_id, kind, actor_user_id, blurt_id)
);

-- The page: a user's notifications, newest first (keyset), read or unread.
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);

-- The unread count, queried on every page for logged-in users, and the unread list.
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

-- Cleanup when a blurt is deleted (deleteBlurts), and when an account is (deleteAccount).
CREATE INDEX notifications_blurt_id_idx ON notifications (blurt_id);
CREATE INDEX notifications_actor_idx ON notifications (actor_user_id);

-- Pruning old read notifications (pruneNotifications).
CREATE INDEX notifications_read_idx ON notifications (read_at) WHERE read_at IS NOT NULL;

-- Down Migration

DROP TABLE notifications;
ALTER TABLE user_profiles
  DROP COLUMN notify_reblurts,
  DROP COLUMN notify_replies,
  DROP COLUMN notify_followed_blurts;
