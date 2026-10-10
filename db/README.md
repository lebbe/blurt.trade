# Database (PostgreSQL)

```
db/
  setup-wsl.sh     installs and configures PostgreSQL + pgvector in WSL (safe to re-run)
  migrate.ts       applies every migration that has not run yet
  migrations/      plain .sql files, applied in filename (timestamp) order
```

## Local development (WSL)

PostgreSQL runs inside WSL Ubuntu on **port 5433**. This machine also has a native
Windows PostgreSQL 16 service on 5432, so 5433 avoids a clash. WSL forwards
`localhost:5433` to Windows, so Windows tools can connect too.

Run Node and npm inside WSL with `nvm use 26`. `node_modules` holds Linux-only native
binaries (argon2, oxlint, onnxruntime), so running `npm install` from Windows breaks
it. If that happens, run `npm ci` in WSL.

First time, from the repo root:

```powershell
wsl -d Ubuntu -u root -- bash db/setup-wsl.sh
```

That installs PostgreSQL and pgvector, creates the `blurt` and `blurt_test` databases
with the `vector` extension, and creates the `blurt` role. `npm start` and `npm run dev`
apply pending migrations before listening. `node db/migrate.ts` does it on its own.
Connection string (also the default in `migrate.ts`):

```
postgres://blurt:blurt@localhost:5433/blurt
```

PostgreSQL is enabled in systemd, so it starts whenever the WSL distro starts.
If you get "connection refused", the distro probably isn't running yet:

```powershell
wsl -d Ubuntu -u root -- systemctl start postgresql
```

A psql shell: `wsl -d Ubuntu -u postgres -- psql -p 5433 -d blurt`

## Tests

`npm test` uses the `blurt_test` database (override with `TEST_DATABASE_URL`) and
wipes all tables before each test, so it never touches your dev data. Tests use a
fake embedder, so they don't load the model.

## Schema changes

Migrations use [node-pg-migrate](https://github.com/salsita/node-pg-migrate) with
plain SQL files. Applied migrations are recorded in the `pgmigrations` table.
`migrate.ts` runs only the ones not yet recorded, each inside a transaction,
under an advisory lock, so two servers starting at the same time can't both run one.

1. Create a new file. Never edit a migration that has already run anywhere:

   ```bash
   node node_modules/node-pg-migrate/bin/node-pg-migrate.js create add-follows -m db/migrations --migration-file-language sql
   ```

2. Write SQL under `-- Up Migration`. Optionally, put the reverse under `-- Down Migration`.
3. Run `node db/migrate.ts`, or just restart the server.

To undo the latest migration (development only):

```bash
DATABASE_URL=postgres://blurt:blurt@localhost:5433/blurt node node_modules/node-pg-migrate/bin/node-pg-migrate.js down -m db/migrations
```

## Production

Set `DATABASE_URL` and start the server. `src/server.ts` runs `migrate()` before it
starts listening, so migrations that haven't run yet are applied on every deploy. If
nothing is pending, it does nothing.

The database needs the pgvector extension. Creating an extension needs a superuser,
so run `CREATE EXTENSION IF NOT EXISTS vector` as one, once per database. The app's
migrations run as the normal app user.

## Tables

| table           | contents                                                          |
| --------------- | ----------------------------------------------------------------- |
| `users`         | `id`, `username` (unique), `password_hash` (Argon2id)             |
| `user_profiles` | one row per user: homepage, social handles, bio                   |
| `blurts`        | `user_id`, `text` (1–280 chars), `parent_id` (reply), `embedding` |

`user_id` appears in every table as the future sharding key (see architecture.md).
A reply is a blurt with a `parent_id`. The main feed lists only top-level blurts.

`embedding` is a 384-dimension vector from the all-MiniLM-L6-v2 model, which runs
locally in Node (`src/embeddings.ts`). The model downloads once, about 23 MB. The
server fills `embedding` in the background after a blurt is posted, and catches up on
any it missed at startup. An HNSW index backs the "related blurts" lookup.
