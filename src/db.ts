import pg from 'pg'
import { defaultDatabaseUrl } from '../db/migrate.ts'

// bigint ids come back as strings by default; ours stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, Number)

// DATABASE_URL points at PgBouncer in transaction pooling mode, which lends a PostgreSQL
// connection for one transaction at a time. So nothing may rely on session state across
// transactions: no session advisory locks, LISTEN, session SET or temp tables. Multi-statement
// work checks out a client and wraps it in BEGIN/COMMIT, which PgBouncer keeps together.
//
// One app connection holds at most one PgBouncer server connection at a time, so a pool no
// bigger than PgBouncer's default_pool_size (20, db/setup-wsl.sh) never makes queries
// queue inside PgBouncer instead of here. With several app processes, split it between them.
export const poolSize = Number(process.env.DB_POOL_SIZE) || 20

let pool: pg.Pool | undefined

// Created on first use so DATABASE_URL can be set before any query runs (e.g. in tests).
export function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? defaultDatabaseUrl,
    max: poolSize,
  })
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}
