// Applies every migration in db/migrations that has not been run yet.
// Run it with `node db/migrate.ts`, or import `migrate()` and await it at server startup.
// Applied migrations are recorded in the `pgmigrations` table. An advisory lock means
// several instances can start at once without running a migration twice.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runner } from 'node-pg-migrate'

export const defaultDatabaseUrl = 'postgres://blurt:blurt@localhost:5433/blurt'

export async function migrate(
  databaseUrl = process.env.DATABASE_URL ?? defaultDatabaseUrl,
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
