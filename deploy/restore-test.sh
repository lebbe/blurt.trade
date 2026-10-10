#!/usr/bin/env bash
# Restores the newest off-server backup into a scratch database, checks it, and drops it.
# Proves that the backups on the remote are complete and restorable. Run as root on the
# database server (or any machine with PostgreSQL + pgvector + PostGIS and the rclone
# remote), at least after setting up backups and then now and then:
#   sudo bash deploy/restore-test.sh            # newest dump on BACKUP_REMOTE
#   sudo bash deploy/restore-test.sh FILE.dump  # a local dump
set -euo pipefail

if [ -f /etc/blurt/backup.env ]; then
  set -a
  . /etc/blurt/backup.env
  set +a
fi
SCRATCH_DB=${SCRATCH_DB:-blurt_restore_test}
WORK=$(mktemp -d)
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

if [ $# -ge 1 ]; then
  DUMP=$1
else
  : "${BACKUP_REMOTE:?Set BACKUP_REMOTE in /etc/blurt/backup.env, or pass a dump file}"
  LATEST=$(rclone lsf --files-only "$BACKUP_REMOTE/" | sort | tail -n 1)
  [ -n "$LATEST" ] || { echo "No backups on $BACKUP_REMOTE" >&2; exit 1; }
  rclone copy "$BACKUP_REMOTE/$LATEST" "$WORK/"
  DUMP=$WORK/$LATEST
fi
chmod 644 "$DUMP"
echo "Restoring $DUMP into $SCRATCH_DB"

psql_admin() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 "$@"; }
psql_admin -qc "DROP DATABASE IF EXISTS $SCRATCH_DB"
psql_admin -qc "CREATE DATABASE $SCRATCH_DB"
# The dump creates the vector and postgis extensions itself, which needs a superuser.
runuser -u postgres -- pg_restore --no-owner --exit-on-error --dbname="$SCRATCH_DB" "$DUMP"

psql_admin -d "$SCRATCH_DB" -c "
  SELECT (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM blurts) AS blurts,
         (SELECT count(*) FROM blurts WHERE embedding IS NOT NULL) AS embedded,
         (SELECT count(*) FROM follows) AS follows,
         (SELECT max(name) FROM pgmigrations) AS latest_migration"

if [ "${KEEP_SCRATCH:-}" != 1 ]; then
  psql_admin -qc "DROP DATABASE $SCRATCH_DB"
fi
echo "Restore OK"
