-- Up Migration

-- Deleting a blurt (deleteBlurts in src/routes/state.ts). A blurt nobody replied to is
-- deleted outright. One with replies stays as a placeholder, a tombstone, so the thread
-- still reads: its text, embedding and author are removed (NULL) and deleted_at is set.
-- No user_id means a tombstone refers to nobody, which account deletion (025) relies on.
-- A tombstone whose last reply goes is deleted too.
ALTER TABLE blurts ADD COLUMN deleted_at timestamptz;
ALTER TABLE blurts ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE blurts ALTER COLUMN text DROP NOT NULL;
ALTER TABLE blurts ADD CONSTRAINT blurts_deleted_removes_content CHECK (
  CASE WHEN deleted_at IS NULL THEN user_id IS NOT NULL AND text IS NOT NULL
       ELSE user_id IS NULL AND text IS NULL AND embedding IS NULL END
);

-- Was ON DELETE CASCADE, which would silently take other people's replies with a deleted
-- blurt. Now deleting a blurt that still has replies fails: go through deleteBlurts.
ALTER TABLE blurts DROP CONSTRAINT blurts_parent_id_fkey;
ALTER TABLE blurts ADD CONSTRAINT blurts_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES blurts (id);

-- Tombstones have no text, so they never wait for an embedding.
DROP INDEX blurts_missing_embedding_idx;
CREATE INDEX blurts_missing_embedding_idx ON blurts (id)
  WHERE embedding IS NULL AND deleted_at IS NULL;

-- The site owner(s): may read /admin/reports and delete anyone's blurt. Set by hand:
-- UPDATE users SET is_admin = true WHERE lower(username) = lower('...');
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

-- One report per user and blurt. user_id (the reporter) is the sharding key. A dismissed
-- report stays, so the same user can't report the same blurt again. Deleting the blurt
-- deletes its reports (deleteBlurts, or the cascade).
CREATE TABLE reports (
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blurt_id     bigint NOT NULL REFERENCES blurts (id) ON DELETE CASCADE,
  reason       text NOT NULL DEFAULT '' CHECK (char_length(reason) <= 500),
  created_at   timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  PRIMARY KEY (user_id, blurt_id)
);

-- Open reports for /admin/reports, and a blurt's reports.
CREATE INDEX reports_blurt_id_idx ON reports (blurt_id);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE dismissed_at IS NULL;

-- Down Migration

DROP TABLE reports;
ALTER TABLE users DROP COLUMN is_admin;
DROP INDEX blurts_missing_embedding_idx;
CREATE INDEX blurts_missing_embedding_idx ON blurts (id) WHERE embedding IS NULL;
ALTER TABLE blurts DROP CONSTRAINT blurts_parent_id_fkey;
ALTER TABLE blurts ADD CONSTRAINT blurts_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES blurts (id) ON DELETE CASCADE;
DELETE FROM blurts WHERE deleted_at IS NOT NULL;
ALTER TABLE blurts DROP CONSTRAINT blurts_deleted_removes_content;
ALTER TABLE blurts ALTER COLUMN text SET NOT NULL;
ALTER TABLE blurts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE blurts DROP COLUMN deleted_at;
