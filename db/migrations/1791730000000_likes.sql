-- Up Migration

-- user_id likes blurt_id. user_id (the liker) is the sharding key, like follows, so a
-- user's likes stay on their own shard. Liking twice is the same row (the primary key).
CREATE TABLE likes (
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blurt_id   bigint NOT NULL REFERENCES blurts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blurt_id)
);

-- Finding (and removing) the likes on a blurt, when it is deleted.
CREATE INDEX likes_blurt_id_idx ON likes (blurt_id);

-- The number of likes, kept on the blurt so lists never count: like() and unlike() in
-- src/routes/state.ts change it in the same transaction as the likes row, under a lock on
-- the blurt, so concurrent likes queue and each adds one.
ALTER TABLE blurts ADD COLUMN like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0);

-- Down Migration

ALTER TABLE blurts DROP COLUMN like_count;
DROP TABLE likes;
