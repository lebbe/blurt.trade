-- Up Migration

-- user_id follows followed_user_id. user_id (the follower) is the sharding key, so a
-- user's following list and following feed stay on their own shard.
CREATE TABLE follows (
  user_id          bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followed_user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, followed_user_id),
  CHECK (user_id <> followed_user_id)
);

-- Follower counts and lists.
CREATE INDEX follows_followed_user_id_idx ON follows (followed_user_id);

-- Down Migration

DROP TABLE follows;
