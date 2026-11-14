-- Up Migration

-- `sessions` was UNLOGGED: a PostgreSQL crash (or a kill after a stop timeout) emptied it,
-- and a promoted replica had no rows at all, since unlogged tables aren't replicated. That
-- logged everyone out, also the 400-day "Keep me logged in" sessions. Logged, it survives
-- crashes and failover. The cost is WAL for one UPDATE per active session every 5 minutes
-- (src/middleware/auth.ts), which is small. Rewrites the table, which is small too.
ALTER TABLE sessions SET LOGGED;

-- Down Migration

ALTER TABLE sessions SET UNLOGGED;
