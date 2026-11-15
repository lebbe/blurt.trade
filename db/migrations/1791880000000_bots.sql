-- Up Migration

-- Bots (tickets/031-bots.md). A bot is an account of its own, made by a person on
-- /settings/bots. It has no password, so nobody can log in as it: its owners manage it from
-- their own accounts (its avatar, its API tokens, who else owns it), and it blurts through
-- /api/v1/ with a token. A bot is drawn as a robot everywhere (avatarColumn in
-- src/routes/state/blurts.ts).
ALTER TABLE users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;
-- A live person has a password, a live bot never has one (*_reblurts.sql has the old rule).
ALTER TABLE users DROP CONSTRAINT users_deleted_is_stub;
ALTER TABLE users ADD CONSTRAINT users_deleted_is_stub CHECK (
  CASE WHEN deleted_at IS NULL THEN username IS NOT NULL AND (password_hash IS NULL) = is_bot
       ELSE username IS NULL AND password_hash IS NULL AND NOT is_admin END
);

-- Who owns a bot: the people who can manage it. Any owner can add another, or leave; the last
-- one can't leave (they delete the bot instead). Admins can set the owner (/admin).
CREATE TABLE bot_owners (
  bot_user_id bigint NOT NULL REFERENCES users (id),
  user_id bigint NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_user_id, user_id)
);
CREATE INDEX bot_owners_user_idx ON bot_owners (user_id);

-- "Hide bots" (/settings): bots this user doesn't follow are left out of their lists, and
-- make them no notifications.
ALTER TABLE user_profiles ADD COLUMN hide_bots boolean NOT NULL DEFAULT false;

-- Bearer tokens for /api/v1/ (src/middleware/auth.ts), one bot's each. Only sha256 of the
-- token is kept: it is 32 random bytes, so it can't be guessed and needs no slow hash.
-- Revoked tokens are deleted, so every row is a live token.
CREATE TABLE api_tokens (
  user_id bigint NOT NULL REFERENCES users (id),
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 50),
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id);

-- Down Migration

DROP TABLE api_tokens;
ALTER TABLE user_profiles DROP COLUMN hide_bots;
DROP TABLE bot_owners;
ALTER TABLE users DROP CONSTRAINT users_deleted_is_stub;
-- Fails while live bots exist: delete them first (/settings/bots).
ALTER TABLE users ADD CONSTRAINT users_deleted_is_stub CHECK (
  CASE WHEN deleted_at IS NULL THEN username IS NOT NULL AND password_hash IS NOT NULL
       ELSE username IS NULL AND password_hash IS NULL AND NOT is_admin END
);
ALTER TABLE users DROP COLUMN is_bot;
