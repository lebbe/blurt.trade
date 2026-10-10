# Deploying blurt.trade

One Linux server runs everything: Caddy (TLS) → Node (the app) → PgBouncer → PostgreSQL
with pgvector and PostGIS. Backups go off the server every night. The files referred to
below are in `deploy/`.

```
deploy/
  blurt.env.example     every environment variable, to copy to /etc/blurt/blurt.env
  blurt.service         systemd unit for the app
  Caddyfile             HTTPS, HTTP → HTTPS redirect, reverse proxy to the app
  pgbouncer.ini         PgBouncer for production (transaction pooling)
  deploy.sh             deploys a git ref: install, check config, model, migrate, restart
  backup.sh             pg_dump, copied off the server with rclone
  blurt-backup.service  runs backup.sh
  blurt-backup.timer    … nightly
  restore-test.sh       restores the newest off-server backup into a scratch database
```

## Choices

- **Host:** one VPS with 4 GB RAM or more, Ubuntu 24.04 LTS, e.g. Hetzner Cloud CX32
  (4 vCPU, 8 GB) in an EU region. The app, the embedding model and PostgreSQL fit together
  with room for the page cache. Grow the server before splitting it up.
- **PostgreSQL:** self-hosted on the same server, from the PGDG apt repository, which has
  `pgvector` and `PostGIS` packages for every version. Managed providers with pgvector and
  PostGIS exist (e.g. Supabase, Crunchy Bridge, Neon), but self-hosting keeps the database
  next to the app, costs nothing extra and matches development (`db/setup-wsl.sh`).
  No read replica at first: `DATABASE_READ_URL` unset means every read goes to the primary
  (see db/README.md, Read replica, for adding one).
- **TLS:** Caddy. It gets and renews Let's Encrypt certificates on its own and redirects
  HTTP to HTTPS by default. The app sends HSTS and the other security headers itself.
- **Process manager:** systemd. Starts on boot, restarts on crash, `SIGTERM` to stop.
- **Migrations:** a deliberate deploy step (`deploy.sh` runs `db/migrate.ts` once, then
  restarts the app), with `MIGRATE_ON_START=false`. With more than one instance, a
  migration at boot would run while other instances still serve the old code; as a step,
  it runs once, and if it fails the running app is left alone. Development keeps migrating
  at startup (`MIGRATE_ON_START` unset). A migration must work with the code that is
  still running until the restart: add first, remove in a later deploy.
- **Backups:** nightly `pg_dump` in custom format, copied with rclone to an S3-compatible
  bucket at another provider (e.g. Backblaze B2 or Hetzner Object Storage), through an
  rclone `crypt` remote because dumps hold password hashes. 30 days on the remote, 3 on
  the server. A day of posts is the most we can lose; WAL archiving (e.g. pgBackRest) can
  come when that is too much.

## Environment

All configuration is environment variables, in `/etc/blurt/blurt.env` (template:
`deploy/blurt.env.example`). The server checks them at startup (`src/config.ts`) and
refuses to start in production when something required is missing or malformed. Check a
file without starting anything: `node --env-file=/etc/blurt/blurt.env src/config.ts`.

| variable                   | default                       | meaning                                                                                                                                                         |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | —                             | `production` turns on HSTS, `Secure` and `__Host-` cookies, and the checks below. Required in production.                                                       |
| `PORT`                     | `3000`                        | Port the app listens on (on all interfaces; firewall it, Caddy is the way in).                                                                                  |
| `JWT_SECRET`               | dev-only value                | Signs session tokens. Required in production, 32+ characters: `openssl rand -base64 48`. Changing it logs everyone out.                                         |
| `DATABASE_URL`             | `localhost:6433/blurt`        | The app's database, through PgBouncer. Required in production.                                                                                                  |
| `MIGRATION_DATABASE_URL`   | `DATABASE_URL`                | Migrations, straight to PostgreSQL (they hold a session advisory lock PgBouncer can't keep). Warned about in production if missing.                             |
| `DATABASE_READ_URL`        | unset: the primary            | A read replica for feeds, related blurts and discovery (db/README.md, Read replica).                                                                            |
| `DB_POOL_SIZE`             | `20`                          | Connections per pool (primary, and replica). At or below PgBouncer's `default_pool_size`, split between app processes.                                          |
| `READ_YOUR_WRITES_SECONDS` | `10`                          | How long after a write a browser reads from the primary. Must outlast replica lag.                                                                              |
| `TRUST_PROXY`              | `false`                       | Express `trust proxy`: `1` behind Caddy. Rate limits key on the client IP, so a wrong value either lumps everyone together or lets clients pick their IP. Required in production (`false` to say there is no proxy). |
| `MIGRATE_ON_START`         | `true`                        | `false` when migrations run as a deploy step (production).                                                                                                      |
| `MODEL_CACHE_DIR`          | inside `node_modules`         | Where the embedding model is downloaded to. Set it outside `node_modules`, which `npm ci` deletes.                                                              |
| `RATE_LIMIT_SCALE`         | `1`                           | Multiplies every rate limit's burst; `0` switches them off (warned about in production).                                                                         |
| `RATE_LIMIT_<NAME>`        | see `src/middleware/rate-limit.ts` | One limit as `burst/period`, e.g. `RATE_LIMIT_LOGIN_IP=10/10m`. Names: `LOGIN_IP`, `LOGIN_USERNAME`, `CREATE_USER_IP`, `WAITLIST_IP`, `BLURT`, `FOLLOW`, `PROFILE_EDIT`, `LOCATION`, `AVATAR`, `REPORT`, `DELETE_BLURT`. See docs/routes.md, Rate limits. |

Only for tests: `TEST_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`,
`TEST_DATABASE_READ_URL` (db/README.md, Tests).

## Setting up the server (once)

As root on a fresh Ubuntu 24.04, with DNS `A`/`AAAA` records for `blurt.trade` and
`www.blurt.trade` pointing at it:

1. **Basics and firewall.** SSH keys only, unattended upgrades, and only 22, 80 and 443
   open:

   ```bash
   apt update && apt -y upgrade
   apt -y install git curl ufw unattended-upgrades rclone
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
   ```

2. **Node 26** from NodeSource (the version the app is developed with; `node` at
   `/usr/bin/node`, as `blurt.service` expects):

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
   apt -y install nodejs
   ```

3. **PostgreSQL, pgvector, PostGIS, PgBouncer** from the PGDG repository:

   ```bash
   apt -y install postgresql-common
   /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
   apt -y install postgresql-18 postgresql-18-pgvector postgresql-18-postgis-3 pgbouncer
   sudo -u postgres psql -c "CREATE ROLE blurt LOGIN PASSWORD '<db password>'"
   sudo -u postgres psql -c "CREATE DATABASE blurt OWNER blurt"
   sudo -u postgres psql -d blurt -c "CREATE EXTENSION vector" -c "CREATE EXTENSION postgis"
   ```

   PostgreSQL listens on localhost only by default; keep it that way. Copy
   `deploy/pgbouncer.ini` to `/etc/pgbouncer/` and write the role's SCRAM hash into
   `/etc/pgbouncer/userlist.txt` (owner `postgres`, mode 640):

   ```bash
   sudo -u postgres psql -tAc "SELECT format('\"%s\" \"%s\"', rolname, rolpassword) FROM pg_authid WHERE rolname = 'blurt'" > /etc/pgbouncer/userlist.txt
   systemctl enable --now postgresql pgbouncer && systemctl restart pgbouncer
   ```

   For a server with 8 GB, raise `shared_buffers` to 2GB and `effective_cache_size` to
   5GB in `/etc/postgresql/18/main/postgresql.conf`.

4. **The app user and code:**

   ```bash
   useradd --system --create-home --home-dir /srv/blurt --shell /bin/bash blurt
   install -d -o blurt -g blurt /var/lib/blurt /var/lib/blurt/models
   sudo -u blurt git clone <repository URL> /srv/blurt/app
   install -d -m 750 -g blurt /etc/blurt
   install -m 640 -g blurt /srv/blurt/app/deploy/blurt.env.example /etc/blurt/blurt.env
   ```

   Fill in `/etc/blurt/blurt.env`: `JWT_SECRET` (`openssl rand -base64 48`) and the
   database password in both URLs. For a private repository, give the blurt user a
   read-only deploy key.

5. **systemd**, and let the blurt user restart its own service (for `deploy.sh`):

   ```bash
   cp /srv/blurt/app/deploy/blurt.service /etc/systemd/system/
   echo 'blurt ALL=(root) NOPASSWD: /usr/bin/systemctl restart blurt' > /etc/sudoers.d/blurt
   chmod 440 /etc/sudoers.d/blurt
   systemctl daemon-reload && systemctl enable blurt
   ```

6. **First deploy:** `sudo -u blurt bash /srv/blurt/app/deploy/deploy.sh` (below).

7. **Caddy:**

   ```bash
   apt -y install caddy
   cp /srv/blurt/app/deploy/Caddyfile /etc/caddy/Caddyfile
   systemctl reload caddy
   ```

   Check: `curl -I http://blurt.trade` is a redirect to `https://`, and
   `curl -I https://blurt.trade` has `strict-transport-security`.

8. **Backups** (below), then **restore one** (below).

9. **Reboot** and check that everything comes back by itself:
   `reboot`, then `systemctl is-active postgresql pgbouncer blurt caddy` and
   `curl -I https://blurt.trade`.

10. **Make yourself admin** (docs/routes.md, Deleting and reporting) after signing up.

## Deploying

```bash
ssh <server>
sudo -u blurt bash /srv/blurt/app/deploy/deploy.sh            # origin/main
sudo -u blurt bash /srv/blurt/app/deploy/deploy.sh <commit>   # or any ref
```

It checks out the ref, runs `npm ci --omit=dev`, checks the configuration, downloads the
embedding model if needed, runs pending migrations once, restarts the app and waits for it
to answer. If any step before the restart fails, the running app is untouched. To roll
back, deploy the previous commit; migrations are not rolled back (write them so the
previous code still works).

A restart drops nothing: systemd sends `SIGTERM`, the server stops accepting connections,
finishes requests in flight, closes its database pools and exits (`src/server.ts`, at
most 10 seconds). Caddy answers 502 for the second or two until the new process listens.

Logs: `journalctl -u blurt -f`. Caddy's access log: `/var/log/caddy/blurt.log`.

## Housekeeping inside the app

- **Sessions:** revoked and idle sessions are deleted at startup and then every hour
  (`deleteDeadSessions`).
- **Embeddings:** blurts are saved without an embedding and embedded in the background.
  Blurts still missing one are picked up at startup, after each post, and every 5 minutes.

## The embedding model

`@huggingface/transformers` runs all-MiniLM-L6-v2 (quantized, ~23 MB download) inside the
app process; loaded, it adds roughly 100–200 MB of memory (check with
`systemctl status blurt` after a few posts; `MemoryMax=1500M` in the unit caps the
whole process). `deploy.sh` downloads it into `MODEL_CACHE_DIR` with
`npm run prefetch-model` (`node src/embeddings.ts`), which also checks that it loads, so
the server never fetches it from the Hugging Face Hub while serving.

If the model fails to load anyway, only embedding fails: posting still works, related
blurts and discovery just miss the new blurts, the error is logged, and the next run
tries again. If the process itself dies (e.g. out of memory), systemd restarts it.

## Backups

1. Configure an rclone remote as root (`rclone config`): the bucket, then a `crypt`
   remote on top of it. Keep the crypt passwords somewhere other than the server (a
   password manager); without them the backups are useless.
2. Write `/etc/blurt/backup.env` (mode 600):

   ```bash
   BACKUP_REMOTE=offsite-crypt:blurt
   ```

3. Install and start the timer, then run one backup now:

   ```bash
   cp /srv/blurt/app/deploy/blurt-backup.{service,timer} /etc/systemd/system/
   systemctl daemon-reload && systemctl enable --now blurt-backup.timer
   systemctl start blurt-backup && journalctl -u blurt-backup -n 20
   ```

`systemctl list-timers blurt-backup` shows the next run. A failed run shows in
`systemctl --failed`.

## Restoring

**Test a restore** after setting up backups, and again every few months:

```bash
sudo bash /srv/blurt/app/deploy/restore-test.sh
```

It downloads the newest dump from the remote, restores it into a scratch database
`blurt_restore_test`, prints row counts and the latest migration, and drops it again
(`KEEP_SCRATCH=1` keeps it for a look). A dump from somewhere else:
`restore-test.sh /path/to/blurt-….dump`.

**A real restore** into production (the app stopped, so nothing writes meanwhile):

```bash
systemctl stop blurt
sudo -u postgres psql -c "ALTER DATABASE blurt RENAME TO blurt_broken"
sudo -u postgres psql -c "CREATE DATABASE blurt OWNER blurt"
sudo -u postgres pg_restore --exit-on-error -d blurt <dump>   # keeps the owners: blurt, and postgres for extensions
systemctl restart pgbouncer && systemctl start blurt
```

Everyone stays logged in only if their session survived: `sessions` is `UNLOGGED` and is
in the dump, so sessions from before the dump work and later ones don't.
