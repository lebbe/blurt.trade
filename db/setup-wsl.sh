#!/usr/bin/env bash
# One-time (and safe to re-run) PostgreSQL + pgvector + PostGIS setup for local development
# in WSL Ubuntu.
# Run from Windows:  wsl -d Ubuntu -u root -- bash db/setup-wsl.sh
#
# Port 5433 is used because a native Windows PostgreSQL may already hold 5432,
# and WSL forwards localhost ports to Windows.
set -euo pipefail

PORT=5433
DB_USER=blurt
DB_PASSWORD=blurt
DB_NAME=blurt
TEST_DB_NAME=blurt_test

export DEBIAN_FRONTEND=noninteractive
if ! command -v pg_lsclusters >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib
fi

VERSION=$(pg_lsclusters --no-header | awk 'NR==1 {print $1}')
for PACKAGE in "postgresql-$VERSION-pgvector" "postgresql-$VERSION-postgis-3"; do
  if ! dpkg -s "$PACKAGE" >/dev/null 2>&1; then
    apt-get install -y -qq "$PACKAGE"
  fi
done
CONF=/etc/postgresql/$VERSION/main/postgresql.conf
if ! grep -q "^port = $PORT" "$CONF"; then
  sed -i "s/^port = [0-9]*/port = $PORT/" "$CONF"
fi

systemctl enable --now "postgresql@$VERSION-main"
systemctl restart "postgresql@$VERSION-main"

psql_admin() { sudo -u postgres psql -p "$PORT" -v ON_ERROR_STOP=1 -tAc "$1"; }

if [ -z "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" ]; then
  psql_admin "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'"
fi
for DB in "$DB_NAME" "$TEST_DB_NAME"; do
  if [ -z "$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$DB'")" ]; then
    psql_admin "CREATE DATABASE $DB OWNER $DB_USER"
  fi
  # Extensions need a superuser, so they are created here rather than in migrations.
  sudo -u postgres psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -qc "CREATE EXTENSION IF NOT EXISTS vector"
  sudo -u postgres psql -p "$PORT" -d "$DB" -v ON_ERROR_STOP=1 -qc "CREATE EXTENSION IF NOT EXISTS postgis"
done

pg_lsclusters
echo "Ready: postgres://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME"
