#!/usr/bin/env bash
# Copies the compose file and .env to the server and (re)starts the stack.
# Run from the repo root: npm run deploy
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] || { echo "Create docker/.env from docker/.env.example first" >&2; exit 1; }
DEPLOY_HOST=$(grep -E '^DEPLOY_HOST=' .env | cut -d= -f2-)
[ -n "$DEPLOY_HOST" ] || { echo "Set DEPLOY_HOST in docker/.env" >&2; exit 1; }

ssh "$DEPLOY_HOST" 'mkdir -p ~/blurt'
scp docker-compose.yml "$DEPLOY_HOST:~/blurt/docker-compose.yml"
scp .env "$DEPLOY_HOST:~/blurt/.env"
ssh "$DEPLOY_HOST" 'cd ~/blurt && chmod 600 .env && docker compose pull && docker compose up -d --remove-orphans && docker image prune -f >/dev/null'
echo "Deployed. Logs: ssh $DEPLOY_HOST 'cd ~/blurt && docker compose logs -f app'"
