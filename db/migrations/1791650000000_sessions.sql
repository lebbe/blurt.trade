-- Up Migration

-- One row per login. Every refresh token descended from that login carries its id, and
-- only the token with current_generation is valid (see src/middleware/auth.ts).
-- UNLOGGED: a crash empties the table, which only means everyone logs in again.
-- user_id is the sharding key.
CREATE UNLOGGED TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  current_generation integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz
);

-- Log out everywhere, and the session count on /settings.
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- Down Migration

DROP TABLE sessions;
