#!/usr/bin/env bash
# One-time (and safe to re-run) PostgreSQL + pgvector + PostGIS + PgBouncer setup for local
# development in WSL Ubuntu, with a streaming read replica of the primary.
# Run from Windows:  wsl -d Ubuntu -u root -- bash db/setup-wsl.sh
#
# Port 5433 is used because a native Windows PostgreSQL may already hold 5432,
# and WSL forwards localhost ports to Windows. PgBouncer listens on 6433 in front of it.
# The read replica is a second cluster on 5434 that streams the primary's WAL.
set -euo pipefail

PORT=5433
REPLICA_PORT=5434
REPLICA_CLUSTER=replica
REPLICATION_SLOT=blurt_replica
PGBOUNCER_PORT=6433
# Server connections per database/user pair. Keep the app's pool size (DB_POOL_SIZE in
# src/db.ts) at or below this.
PGBOUNCER_POOL_SIZE=20
DB_USER=blurt
DB_PASSWORD=blurt
DB_NAME=blurt
TEST_DB_NAME=blurt_test

export DEBIAN_FRONTEND=noninteractive
if ! command -v pg_lsclusters >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib
fi
if ! command -v pgbouncer >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq pgbouncer
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

# Streaming read replica: a second cluster, copied from the primary with pg_basebackup.
# -R makes it a standby that follows the primary; the replication slot makes the primary
# keep WAL until the replica has it (so a stopped replica makes WAL pile up on the primary:
# drop the cluster and the slot if you stop using it, see db/README.md). The postgres OS
# user connects over the Unix socket (peer auth, pg_hba.conf's "local replication" line).
# The replica holds every database of the primary, blurt_test included, and is read-only.
REPLICA_DATA=/var/lib/postgresql/$VERSION/$REPLICA_CLUSTER
if ! pg_lsclusters --no-header | awk '{print $2}' | grep -qx "$REPLICA_CLUSTER"; then
  pg_createcluster "$VERSION" "$REPLICA_CLUSTER" -p "$REPLICA_PORT" >/dev/null
  rm -rf "$REPLICA_DATA"
  if [ -n "$(psql_admin "SELECT 1 FROM pg_replication_slots WHERE slot_name = '$REPLICATION_SLOT'")" ]; then
    psql_admin "SELECT pg_drop_replication_slot('$REPLICATION_SLOT')" >/dev/null
  fi
  sudo -u postgres pg_basebackup -h /var/run/postgresql -p "$PORT" -D "$REPLICA_DATA"     -R -X stream -C -S "$REPLICATION_SLOT"
fi
systemctl enable --now "postgresql@$VERSION-$REPLICA_CLUSTER"
systemctl restart "postgresql@$VERSION-$REPLICA_CLUSTER"

# PgBouncer in transaction pooling mode: a server connection is lent to a client for one
# transaction at a time. Migrations bypass it (session advisory lock), see db/README.md.
cat >/etc/pgbouncer/pgbouncer.ini <<INI
[databases]
$DB_NAME = host=127.0.0.1 port=$PORT dbname=$DB_NAME
$TEST_DB_NAME = host=127.0.0.1 port=$PORT dbname=$TEST_DB_NAME
${DB_NAME}_read = host=127.0.0.1 port=$REPLICA_PORT dbname=$DB_NAME
${TEST_DB_NAME}_read = host=127.0.0.1 port=$REPLICA_PORT dbname=$TEST_DB_NAME

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = $PGBOUNCER_PORT
unix_socket_dir = /var/run/postgresql
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
admin_users = postgres
pool_mode = transaction
default_pool_size = $PGBOUNCER_POOL_SIZE
max_client_conn = 500
max_prepared_statements = 200
ignore_startup_parameters = extra_float_digits
logfile = /var/log/postgresql/pgbouncer.log
pidfile = /var/run/postgresql/pgbouncer.pid
INI
# Development password in plain text: PgBouncer uses it both to check clients and to log
# in to PostgreSQL.
printf '"%s" "%s"\n' "$DB_USER" "$DB_PASSWORD" >/etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/pgbouncer.ini /etc/pgbouncer/userlist.txt
chmod 640 /etc/pgbouncer/pgbouncer.ini /etc/pgbouncer/userlist.txt

systemctl enable pgbouncer
systemctl restart pgbouncer

pg_lsclusters
systemctl is-active pgbouncer
echo "Ready: postgres://$DB_USER:$DB_PASSWORD@localhost:$PGBOUNCER_PORT/$DB_NAME (through PgBouncer)"
echo "       postgres://$DB_USER:$DB_PASSWORD@localhost:$PGBOUNCER_PORT/${DB_NAME}_read (read replica, through PgBouncer)"
echo "       postgres://$DB_USER:$DB_PASSWORD@localhost:$PORT/$DB_NAME (direct, for migrations)"
