# Database (PostgreSQL)

```
db/
  setup-wsl.sh     installs and configures PostgreSQL + pgvector + PostGIS + PgBouncer in WSL (safe to re-run)
  migrate.ts       applies every migration that has not run yet
  mint-invites.ts  mints invite codes in bulk (see docs/routes.md, Invite codes)
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

That installs PostgreSQL, pgvector, PostGIS and PgBouncer, creates the `blurt` and
`blurt_test` databases with the `vector` and `postgis` extensions, creates the `blurt`
role, and puts PgBouncer on **port 6433** in front of both databases. `npm start` and
`npm run dev` apply pending migrations before listening. `node db/migrate.ts` does it on
its own. Connection strings (the defaults in `db/migrate.ts`):

```
postgres://blurt:blurt@localhost:6433/blurt   the app (DATABASE_URL), through PgBouncer
postgres://blurt:blurt@localhost:5433/blurt   migrations (MIGRATION_DATABASE_URL), direct
```

PostgreSQL and PgBouncer are enabled in systemd, so they start whenever the WSL distro
starts. If you get "connection refused", the distro probably isn't running yet:

```powershell
wsl -d Ubuntu -u root -- systemctl start postgresql pgbouncer
```

A psql shell: `wsl -d Ubuntu -u postgres -- psql -p 5433 -d blurt`

## Connection pooling (PgBouncer)

The app talks to PgBouncer, not to PostgreSQL. PgBouncer keeps a few PostgreSQL
connections open and lends them out, so a request never pays for a new connection.
`db/setup-wsl.sh` writes `/etc/pgbouncer/pgbouncer.ini` and `userlist.txt` (re-run it
after changing them there; edits in `/etc` are overwritten). Its log is
`/var/log/postgresql/pgbouncer.log`.

It runs in **transaction pooling** mode: a PostgreSQL connection belongs to a client for
one transaction, then goes back to the pool. Code that uses `db()` must therefore not
rely on session state between transactions: no session-level advisory locks,
`LISTEN`/`NOTIFY`, plain `SET` (use `SET LOCAL` inside a transaction), or temporary
tables. Several statements that belong together go on one client from `db().connect()`
inside `BEGIN`…`COMMIT`, as `addUser` in `src/routes/state.ts` does. Parameterised queries are fine, and so are
named prepared statements (`max_prepared_statements` is on).

Pool sizes: PgBouncer opens at most `default_pool_size` = 20 PostgreSQL connections per
database and user, and accepts up to 500 clients. The app's `pg.Pool` defaults to 20
connections (`DB_POOL_SIZE`), so a single server never asks for more than PgBouncer will
lend at once. With several app processes behind one PgBouncer, split it between them
(e.g. `DB_POOL_SIZE=5` for four processes), or raise `default_pool_size` together with
PostgreSQL's `max_connections` (100 by default).

**Migrations bypass PgBouncer.** node-pg-migrate holds a session-level advisory lock
while it runs, which transaction pooling can't keep. `migrate()` connects to
`MIGRATION_DATABASE_URL`, else `DATABASE_URL`, else `localhost:5433`. When `DATABASE_URL`
points at PgBouncer, always set `MIGRATION_DATABASE_URL` to PostgreSQL itself.

## Tests

`npm test` uses the `blurt_test` database and wipes all tables before each test, so it
never touches your dev data. Like the app, its queries go through PgBouncer (override
with `TEST_DATABASE_URL`) and its migrations go straight to PostgreSQL (override with
`TEST_MIGRATION_DATABASE_URL`). Tests use a fake embedder, so they don't load the model.

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

Set `DATABASE_URL` (PgBouncer in transaction mode, or PostgreSQL itself) and, when it
points at PgBouncer, `MIGRATION_DATABASE_URL` (PostgreSQL directly). Size `DB_POOL_SIZE`
to PgBouncer's pool as described above. Then start the server. `src/server.ts` runs `migrate()` before it
starts listening, so migrations that haven't run yet are applied on every deploy. If
nothing is pending, it does nothing.

The database needs the pgvector and PostGIS extensions. Creating an extension needs a
superuser, so run `CREATE EXTENSION IF NOT EXISTS vector` and
`CREATE EXTENSION IF NOT EXISTS postgis` as one, once per database. The app's
migrations run as the normal app user.

## Tables

| table            | contents                                                          |
| ---------------- | ----------------------------------------------------------------- |
| `users`          | `id`, `username` (unique), `password_hash` (Argon2id)             |
| `user_profiles`  | one row per user: homepage, social handles, bio, `location`       |
| `blurts`         | `user_id`, `text` (1–280 chars), `parent_id` (reply), `embedding` |
| `follows`        | `user_id` follows `followed_user_id`                              |
| `sessions`       | one row per login: refresh token generation, last use, revoked    |
| `signup_counter` | exactly one row: sign-ups so far, `soft_limit`, `hard_limit`      |
| `waitlist`       | usernames that asked to be let in while sign-up was full          |
| `invite_codes`   | single-use sign-up codes: owner `user_id`, `used_by_user_id`      |

`user_id` appears in every table as the future sharding key (see architecture.md).
`sessions` is `UNLOGGED`: a crash empties it, which only logs everyone out. The server
deletes revoked and expired rows at startup.

`signup_counter` starts at 1000 (soft) and 10000 (hard). Raise them without a deploy:

```sql
UPDATE signup_counter SET soft_limit = 2000, hard_limit = 20000;
```

`current_count` counts sign-ups, not current users: it never goes down.
`waitlist` stores only a username and a status (`waiting`, or `joined` once it signs
up), no email. See docs/routes.md, Sign-up limits.

An invite code counts as used once `used_at` is set, not by `used_by_user_id`, which
would go `NULL` if the invitee's account were deleted: the code must not work again.
The migration gave every existing user 3 codes, as new users get at sign-up.

A reply is a blurt with a `parent_id`. The main feed lists only top-level blurts.

`location` is a PostGIS `geography(Point, 4326)`, `NULL` until the user sets one. It is
always the centre of a 1° grid cell (a `CHECK` enforces it), never an exact position. A
GiST index backs the `ST_DWithin` radius queries. See docs/routes.md, Location.

`embedding` is a 384-dimension vector from the all-MiniLM-L6-v2 model, which runs
locally in Node (`src/embeddings.ts`). The model downloads once, about 23 MB. The
server fills `embedding` in the background after a blurt is posted, and catches up on
any it missed at startup. An HNSW index backs the "related blurts" lookup.
