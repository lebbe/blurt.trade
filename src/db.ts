import pg from 'pg'
import { defaultDatabaseUrl } from '../db/migrate.ts'

// bigint ids come back as strings by default; ours stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, Number)

let pool: pg.Pool | undefined

// Created on first use so DATABASE_URL can be set before any query runs (e.g. in tests).
export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL ?? defaultDatabaseUrl })
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}
