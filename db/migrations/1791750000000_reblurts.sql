-- Up Migration

-- Reblurts, and blurt rows that never go away (ticket 030). See "Reblurts" and "Deleting
-- blurts" in docs/routes.md, and the shown-blurt query in src/routes/state.ts.
--
-- A reblurt is a row in blurts that points at another one:
--
--   blurt / reply   reblurt_of_id NULL, text set    shown as its own text
--   plain reblurt   reblurt_of_id set,  text NULL   shown as the original, "Reblurted by"
--   quote-reblurt   reblurt_of_id set,  text set    its own text, the original embedded
--
-- "Plain reblurt" is reblurt_of_id IS NOT NULL AND text IS NULL AND deleted_at IS NULL:
-- a deleted quote also has reblurt_of_id set and text NULL. The app writes that condition
-- once (plainReblurt in src/routes/state.ts); the indexes below repeat it.
--
-- reblurt_of_user_id is the original's author, copied, so a lookup by (user_id, id) of the
-- original goes to one shard once blurts are sharded by user_id. Neither column cascades:
-- the software handles relations. The foreign key stays as an assertion while there is
-- one database, and goes the day it is sharded.
ALTER TABLE blurts
  ADD COLUMN reblurt_of_id bigint REFERENCES blurts (id),
  ADD COLUMN reblurt_of_user_id bigint,
  ADD CONSTRAINT blurts_reblurt_of_user CHECK ((reblurt_of_id IS NULL) = (reblurt_of_user_id IS NULL)),
  ADD CONSTRAINT blurts_reblurt_not_self CHECK (reblurt_of_id <> id),
  -- A plain reblurt is not a reply.
  ADD CONSTRAINT blurts_plain_reblurt_not_reply
    CHECK (parent_id IS NULL OR text IS NOT NULL OR deleted_at IS NOT NULL);

-- Content rows (blurts, replies, quotes) are never removed any more: deleting one sets
-- deleted_at and removes its text and embedding, and keeps user_id (the sharding key),
-- parent_id and reblurt_of_id. That a deleted blurt says nothing about who wrote it is
-- enforced when reading. Tombstones from before this have user_id NULL, which can't be
-- recovered, so a deleted row may still have none.
ALTER TABLE blurts DROP CONSTRAINT blurts_deleted_removes_content;
ALTER TABLE blurts ADD CONSTRAINT blurts_deleted_removes_content CHECK (
  CASE WHEN deleted_at IS NULL
       THEN user_id IS NOT NULL AND (text IS NOT NULL OR reblurt_of_id IS NOT NULL)
       ELSE text IS NULL AND embedding IS NULL END
);

-- Was ON DELETE CASCADE. Users are never deleted now (a stub row stays), and nothing
-- cascades from them into blurts.
ALTER TABLE blurts DROP CONSTRAINT blurts_user_id_fkey;
ALTER TABLE blurts ADD CONSTRAINT blurts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id);

-- One plain reblurt per user and original. Also answers "did the viewer reblurt these" for
-- a page of blurts.
CREATE UNIQUE INDEX blurts_plain_reblurt_key ON blurts (user_id, reblurt_of_id)
  WHERE reblurt_of_id IS NOT NULL AND text IS NULL AND deleted_at IS NULL;

-- The reblurts and quotes of a blurt: deduplicating the following feed, and cleanup.
CREATE INDEX blurts_reblurt_of_id_idx ON blurts (reblurt_of_id) WHERE reblurt_of_id IS NOT NULL;

-- Only rows with text wait for an embedding: plain reblurts have none, and neither do
-- deleted blurts.
DROP INDEX blurts_missing_embedding_idx;
CREATE INDEX blurts_missing_embedding_idx ON blurts (id)
  WHERE embedding IS NULL AND text IS NOT NULL;

-- Counters, off the blurts row: a counter update writes a whole new row version, and on
-- blurts that includes the 384-float embedding (about 1.5 KB per like), and a viral blurt
-- becomes one hot row. Here an update locks only this narrow row. No row means all zero.
-- reblurt_count counts plain reblurts, not quotes.
CREATE TABLE blurt_stats (
  blurt_id      bigint PRIMARY KEY REFERENCES blurts (id),
  like_count    integer NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  reblurt_count integer NOT NULL DEFAULT 0 CHECK (reblurt_count >= 0)
);

INSERT INTO blurt_stats (blurt_id, like_count)
SELECT id, like_count FROM blurts WHERE like_count > 0;

ALTER TABLE blurts DROP COLUMN like_count;

-- Deleting an account keeps a stub users row: deleted_at set, and the username, password
-- hash and profile removed (retired_usernames keeps the name taken). So blurts.user_id
-- stays valid on the deleted account's tombstones, and nothing cascades from users.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ALTER COLUMN username DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_deleted_is_stub CHECK (
  CASE WHEN deleted_at IS NULL THEN username IS NOT NULL AND password_hash IS NOT NULL
       ELSE username IS NULL AND password_hash IS NULL AND NOT is_admin END
);

-- Down Migration

ALTER TABLE users DROP CONSTRAINT users_deleted_is_stub;
UPDATE blurts SET user_id = NULL
  WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
DELETE FROM users WHERE deleted_at IS NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
ALTER TABLE users DROP COLUMN deleted_at;

ALTER TABLE blurts ADD COLUMN like_count integer NOT NULL DEFAULT 0 CHECK (like_count >= 0);
UPDATE blurts b SET like_count = s.like_count FROM blurt_stats s WHERE s.blurt_id = b.id;
DROP TABLE blurt_stats;

DROP INDEX blurts_missing_embedding_idx;
CREATE INDEX blurts_missing_embedding_idx ON blurts (id)
  WHERE embedding IS NULL AND deleted_at IS NULL;
DROP INDEX blurts_reblurt_of_id_idx;
DROP INDEX blurts_plain_reblurt_key;

DELETE FROM blurts WHERE reblurt_of_id IS NOT NULL AND text IS NULL AND deleted_at IS NULL;
UPDATE blurts SET user_id = NULL WHERE deleted_at IS NOT NULL;
ALTER TABLE blurts DROP CONSTRAINT blurts_user_id_fkey;
ALTER TABLE blurts ADD CONSTRAINT blurts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE blurts DROP CONSTRAINT blurts_deleted_removes_content;
ALTER TABLE blurts ADD CONSTRAINT blurts_deleted_removes_content CHECK (
  CASE WHEN deleted_at IS NULL THEN user_id IS NOT NULL AND text IS NOT NULL
       ELSE user_id IS NULL AND text IS NULL AND embedding IS NULL END
);
ALTER TABLE blurts
  DROP CONSTRAINT blurts_plain_reblurt_not_reply,
  DROP CONSTRAINT blurts_reblurt_not_self,
  DROP CONSTRAINT blurts_reblurt_of_user,
  DROP COLUMN reblurt_of_user_id,
  DROP COLUMN reblurt_of_id;
