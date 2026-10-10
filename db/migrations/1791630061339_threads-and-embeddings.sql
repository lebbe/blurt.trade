-- Up Migration

-- The vector extension itself is created by a superuser (see db/setup-wsl.sh);
-- this is a no-op when it already exists, and fails loudly when it doesn't.
CREATE EXTENSION IF NOT EXISTS vector;

-- A reply is a blurt with a parent. NULL means a top-level blurt.
ALTER TABLE blurts ADD COLUMN parent_id bigint REFERENCES blurts (id) ON DELETE CASCADE;

-- all-MiniLM-L6-v2 sentence embedding, normalized. NULL until computed in the background.
ALTER TABLE blurts ADD COLUMN embedding vector(384);

-- Replies to a blurt, newest first.
CREATE INDEX blurts_parent_id_created_at_idx ON blurts (parent_id, created_at DESC, id DESC)
  WHERE parent_id IS NOT NULL;

-- The main feed only lists top-level blurts.
CREATE INDEX blurts_top_level_created_at_idx ON blurts (created_at DESC, id DESC)
  WHERE parent_id IS NULL;

-- Nearest-neighbour search for related blurts.
CREATE INDEX blurts_embedding_idx ON blurts USING hnsw (embedding vector_cosine_ops);

-- Finds blurts still waiting for an embedding.
CREATE INDEX blurts_missing_embedding_idx ON blurts (id) WHERE embedding IS NULL;

-- Down Migration

DROP INDEX blurts_missing_embedding_idx;
DROP INDEX blurts_embedding_idx;
DROP INDEX blurts_top_level_created_at_idx;
DROP INDEX blurts_parent_id_created_at_idx;
ALTER TABLE blurts DROP COLUMN embedding;
ALTER TABLE blurts DROP COLUMN parent_id;
