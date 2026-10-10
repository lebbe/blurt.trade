// Applies every migration in db/migrations that has not been run yet.
// Run it with `node db/migrate.ts`, or import `migrate()` and await it at server startup.
// Applied migrations are recorded in the `pgmigrations` table. An advisory lock means
// several instances can start at once without running a migration twice.
//
// That lock is a session-level advisory lock, which PgBouncer's transaction pooling can't
// keep (the next statement may run on another server connection). So migrations connect
// to PostgreSQL directly: MIGRATION_DATABASE_URL, else DATABASE_URL, else local port 5433.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runner } from 'node-pg-migrate'

// The app's queries go through PgBouncer (6433); migrations go straight to PostgreSQL (5433).
export const defaultDatabaseUrl = 'postgres://blurt:blurt@localhost:6433/blurt'
export const defaultMigrationDatabaseUrl = 'postgres://blurt:blurt@localhost:5433/blurt'

export async function migrate(
  databaseUrl = process.env.MIGRATION_DATABASE_URL ??
    process.env.DATABASE_URL ??
    defaultMigrationDatabaseUrl,
): Promise<void> {
  await runner({
    databaseUrl,
    dir: join(import.meta.dirname, 'migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    log: () => {},
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate()
  console.log('Database schema is up to date')
}
