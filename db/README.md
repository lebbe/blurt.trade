# Database (PostgreSQL)

```
db/
  setup-wsl.sh     installs and configures PostgreSQL + pgvector + PostGIS + PgBouncer and a
                   streaming read replica in WSL (safe to re-run)
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
role, starts a streaming read replica on **port 5434** (see Read replica below), and puts
PgBouncer on **port 6433** in front of both. `npm start` and
`npm run dev` apply pending migrations before listening. `node db/migrate.ts` does it on
its own. Connection strings (the defaults in `db/migrate.ts`):

```
postgres://blurt:blurt@localhost:6433/blurt        the app (DATABASE_URL), through PgBouncer
postgres://blurt:blurt@localhost:6433/blurt_read   heavy reads (DATABASE_READ_URL), the replica
postgres://blurt:blurt@localhost:5433/blurt        migrations (MIGRATION_DATABASE_URL), direct
```

PostgreSQL and PgBouncer are enabled in systemd, so they start whenever the WSL distro
starts. If you get "connection refused", the distro probably isn't running yet:

```powershell
wsl -d Ubuntu -u root -- systemctl start postgresql pgbouncer
```

`DATABASE_READ_URL` is not set by default, so `npm run dev` reads everything from the
primary. Set it to the `blurt_read` URL above to use the replica.

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

## Read replica

One primary takes every write; one streaming replica takes the heavy reads: the feeds
(everyone, following, profiles, replies, near you), related blurts and the discovery
sections. That keeps vector and geo searches off the write path. In development the replica
is a second cluster in the same WSL (`18 replica`, port 5434), made by `pg_basebackup -R`
from the primary. It follows the primary's WAL over a physical replication slot
(`blurt_replica`), holds every database (`blurt`, `blurt_test`) and is read-only. PgBouncer
serves it as `blurt_read` and `blurt_test_read`.

In code, `dbRead()` in `src/db.ts` is a second pool from `DATABASE_READ_URL`; unset, it is
just `db()`, so one database is enough. Queries in `src/routes/state.ts` that may be a
moment stale use `dbRead()`. Everything else, and anything that decides a write, stays on
`db()`: auth and sessions, sign-up limits and invite codes, single blurts by id, profile
data, follow counts and locations.

**Read your own writes.** Replication is asynchronous, so right after a write the replica
may not have it yet. Any request that can write (not `GET`, `HEAD` or `OPTIONS`) reads from the primary
throughout, and sets a `recent_write` cookie (HttpOnly, `SameSite=Lax`) for 10 seconds
(`READ_YOUR_WRITES_SECONDS`). Requests carrying it read from the primary too
(`src/middleware/replica.ts`). The redirect after posting a blurt carries it, so the poster
always sees their blurt straight away; other people see it once the replica catches up,
normally well under a second later. If the replica ever lags by more than the window, a
poster may briefly miss their own change after it, so watch the lag:

```sql
-- on the primary
SELECT application_name, state, replay_lag FROM pg_stat_replication;
```

JSON callers get the new blurt in the `201` response. Without a cookie jar, their next
`GET` may come from the replica and not show it for a moment.

The replication slot makes the primary keep WAL until the replica has replayed it, so a
replica that is down for long fills the primary's disk. To drop the replica:

```bash
sudo pg_dropcluster 18 replica --stop
sudo -u postgres psql -p 5433 -c "SELECT pg_drop_replication_slot('blurt_replica')"
```

Re-running `db/setup-wsl.sh` creates it again from a fresh copy. Sharding, cascading
replicas, several writers and caches wait until the primary actually struggles (see
architecture.md).

## Tests

`npm test` uses the `blurt_test` database and wipes all tables before each test, so it
never touches your dev data. Like the app, its queries go through PgBouncer (override
with `TEST_DATABASE_URL`) and its migrations go straight to PostgreSQL (override with
`TEST_MIGRATION_DATABASE_URL`). Reads use the primary too, except in the read replica tests,
one of which needs the real replica (`blurt_test_read`, override with
`TEST_DATABASE_READ_URL`). Tests use a fake embedder, so they don't load the model.

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
points at PgBouncer, `MIGRATION_DATABASE_URL` (PostgreSQL directly). With a read replica,
set `DATABASE_READ_URL` to it (through PgBouncer too); the replica gets the same
`DB_POOL_SIZE` pool. Size `DB_POOL_SIZE`
to PgBouncer's pool as described above. By default `src/server.ts` runs `migrate()` before
it starts listening; if nothing is pending, it does nothing. In production
`MIGRATE_ON_START=false`, and `deploy/deploy.sh` runs `node db/migrate.ts` once before
restarting the app, so several instances never race a migration against old code. The
whole setup, backups included, is in docs/deploy.md.

The database needs the pgvector and PostGIS extensions. Creating an extension needs a
superuser, so run `CREATE EXTENSION IF NOT EXISTS vector` and
`CREATE EXTENSION IF NOT EXISTS postgis` as one, once per database. The app's
migrations run as the normal app user.

## Tables

| table               | contents                                                          |
| ------------------- | ----------------------------------------------------------------- |
| `users`             | `id`, `username` (unique), `password_hash` (Argon2id)             |
| `user_profiles`     | one row per user: homepage, social handles, bio, `location`       |
| `blurts`            | `user_id`, `text`, `parent_id` (reply), `embedding`, `like_count` |
| `follows`           | `user_id` follows `followed_user_id`                              |
| `likes`             | `user_id` likes `blurt_id` (`blurts.like_count` is the count)     |
| `sessions`          | one row per login: refresh token generation, last use, revoked    |
| `signup_counter`    | exactly one row: sign-ups so far, `soft_limit`, `hard_limit`      |
| `waitlist`          | usernames that asked to be let in while sign-up was full          |
| `invite_codes`      | single-use sign-up codes: owner `user_id`, `used_by_user_id`      |
| `retired_usernames` | usernames of deleted accounts, lower case, nothing else           |

`user_id` appears in every table as the future sharding key (see architecture.md).
`sessions` is `UNLOGGED`: a crash empties it, which only logs everyone out. The server
deletes revoked and expired rows at startup and every hour.

`signup_counter` starts at 1000 (soft) and 10000 (hard). Raise them without a deploy:

```sql
UPDATE signup_counter SET soft_limit = 2000, hard_limit = 20000;
```

`current_count` counts sign-ups, not current users: it never goes down, also not when
an account is deleted.

Deleting an account (`deleteAccount` in `src/routes/state.ts`, docs/routes.md, Deleting an
account) removes every row that refers to the user, in one transaction, and puts the
username in `retired_usernames` so it can never be signed up for again.
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

Search (`/search`) uses a GIN index on `to_tsvector('simple', text)`, an expression index,
not a stored column. The query must repeat that expression exactly (`blurtSearchWhere` in
`src/routes/state.ts`); a test checks with `EXPLAIN` that the index is used. Username
search is a substring match (`strpos`) that scans `users`; add a `pg_trgm` index if that
ever gets slow.
