-- Up Migration

-- Live updates (GET /api/events, src/events.ts). Each app instance keeps one direct
-- connection to PostgreSQL that LISTENs on the channel blurt_events (LISTEN_DATABASE_URL:
-- PgBouncer's transaction pooling can't hold a LISTEN). These triggers NOTIFY it, so a
-- change made through any instance reaches the browsers connected to every instance.
-- NOTIFY is transactional: it is delivered at COMMIT, and not at all on ROLLBACK, and
-- identical payloads within one transaction are delivered once (so marking 100
-- notifications read, or deleting an account, is one message per user, not one per row).
-- Payloads are tiny JSON with ids only; the listener looks up anything else itself.
--
--   {"t":"n","u":<user_id>}             that user's notifications changed (new, read, gone)
--   {"t":"b","id":<id>,"u":<user_id>,   a top-level blurt or plain reblurt was posted, by
--    "o":<original id or null>}         u; o is what a plain reblurt reblurts
CREATE FUNCTION notify_notifications_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('blurt_events',
    json_build_object('t', 'n', 'u', (CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END).user_id)::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER notifications_changed
  AFTER INSERT OR DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notify_notifications_changed();

CREATE TRIGGER notifications_read
  AFTER UPDATE OF read_at ON notifications
  FOR EACH ROW WHEN (OLD.read_at IS DISTINCT FROM NEW.read_at)
  EXECUTE FUNCTION notify_notifications_changed();

-- Only rows a feed can show at the top: top-level blurts and quotes, and plain reblurts
-- (the following feed shows those). Replies are never in a feed's list.
CREATE FUNCTION notify_blurt_posted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('blurt_events', json_build_object(
    't', 'b', 'id', NEW.id, 'u', NEW.user_id,
    'o', CASE WHEN NEW.text IS NULL THEN NEW.reblurt_of_id END)::text);
  RETURN NULL;
END
$$;

CREATE TRIGGER blurt_posted
  AFTER INSERT ON blurts
  FOR EACH ROW WHEN (NEW.parent_id IS NULL)
  EXECUTE FUNCTION notify_blurt_posted();

-- Web Push (src/push.ts): one row per browser that asked for notifications with "Notify
-- me on this device" on the edit page. `endpoint` is the push service's URL for that
-- browser (Google's, Mozilla's, Apple's...), the one secret-ish thing here: whoever has it
-- can wake that browser. p256dh and auth are the browser's keys for encrypted payloads;
-- our pushes have no payload, so they are only kept so payloads could be added later.
--
-- Tied to the login (session) it was made in: pushes stop as soon as the session is
-- revoked (logging out, "Log out everywhere": claimPushEndpoints skips those), and the row
-- goes with the session when the hourly cleanup deletes it (ON DELETE CASCADE), and with
-- account deletion (deleteAccount deletes them by user_id).
--
-- pushed_at: when this device was last pushed to, so a burst of notifications is one push
-- (src/push.ts, pushIntervalSeconds), across all instances.
CREATE TABLE push_subscriptions (
  endpoint   text PRIMARY KEY CHECK (length(endpoint) <= 1000),
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  p256dh     text NOT NULL CHECK (length(p256dh) <= 200),
  auth       text NOT NULL CHECK (length(auth) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  pushed_at  timestamptz
);

CREATE INDEX push_subscriptions_user_id_idx ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_session_id_idx ON push_subscriptions (session_id);

-- Down Migration

DROP TABLE push_subscriptions;
DROP TRIGGER blurt_posted ON blurts;
DROP FUNCTION notify_blurt_posted();
DROP TRIGGER notifications_read ON notifications;
DROP TRIGGER notifications_changed ON notifications;
DROP FUNCTION notify_notifications_changed();
