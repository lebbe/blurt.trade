-- Up Migration

-- Full-text search over blurt text (/search). An expression index, not a stored tsvector
-- column: the query repeats the expression exactly (blurtSearchWhere in
-- src/routes/state.ts), and nothing new is stored. 'simple' lowercases and splits words
-- without stemming or stop words, so Norwegian and English (and anything else) work the
-- same, at the price of "cats" not finding "cat". Placeholders of deleted blurts have
-- NULL text, so they are never in it.
CREATE INDEX blurts_text_search_idx ON blurts USING gin (to_tsvector('simple', text));

-- Down Migration

DROP INDEX blurts_text_search_idx;
