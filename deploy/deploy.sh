#!/usr/bin/env bash
# Deploys a git ref on the server: sudo -u blurt bash /srv/blurt/app/deploy/deploy.sh [ref]
# (default origin/main). Run as the blurt user, which may restart the service through
# the sudoers rule in docs/deploy.md. Stops before touching the running app if anything
# fails, so a broken build never replaces a working one.
set -euo pipefail

REF=${1:-origin/main}
APP=/srv/blurt/app
ENV_FILE=/etc/blurt/blurt.env
PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)
PORT=${PORT:-3000}

cd "$APP"
git fetch --quiet origin
git checkout --quiet --detach "$REF"
echo "Deploying $(git log -1 --format='%h %s')"

npm ci --omit=dev --no-audit --no-fund
node --env-file="$ENV_FILE" src/config.ts
# Download (or verify) the embedding model now, not on the first post.
node --env-file="$ENV_FILE" src/embeddings.ts
# Once, before the new code serves traffic (MIGRATE_ON_START=false in the env file).
# Migrations must keep working with the code that is still running until the restart.
node --env-file="$ENV_FILE" db/migrate.ts

sudo systemctl restart blurt
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
    echo "Deployed and answering on port $PORT"
    exit 0
  fi
  sleep 1
done
echo "The app did not answer after restart; see: journalctl -u blurt -n 100" >&2
exit 1
