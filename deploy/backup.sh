#!/usr/bin/env bash
# Nightly backup: pg_dump of the blurt database, copied off the server with rclone.
# Run by blurt-backup.timer as root. Settings come from /etc/blurt/backup.env:
#   BACKUP_REMOTE   rclone destination, e.g. offsite-crypt:blurt (an encrypted remote:
#                   dumps hold password hashes)
#   BACKUP_DIR      local copies (default /var/backups/blurt)
#   KEEP_LOCAL      local dumps to keep (default 3)
#   KEEP_DAYS       days to keep dumps on the remote (default 30)
set -euo pipefail

DB_NAME=${DB_NAME:-blurt}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/blurt}
KEEP_LOCAL=${KEEP_LOCAL:-3}
KEEP_DAYS=${KEEP_DAYS:-30}
: "${BACKUP_REMOTE:?Set BACKUP_REMOTE in /etc/blurt/backup.env}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
FILE="$BACKUP_DIR/$DB_NAME-$(date -u +%Y%m%dT%H%M%SZ).dump"

# Custom format: compressed, and pg_restore can pick tables or run in parallel.
runuser -u postgres -- pg_dump --format=custom --dbname="$DB_NAME" >"$FILE.partial"
mv "$FILE.partial" "$FILE"
# A dump that pg_restore can't list is no backup.
pg_restore --list "$FILE" >/dev/null

rclone copy "$FILE" "$BACKUP_REMOTE/"
rclone delete --min-age "${KEEP_DAYS}d" "$BACKUP_REMOTE/"

# Keep only the newest few locally.
ls -1t "$BACKUP_DIR"/"$DB_NAME"-*.dump | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm --
echo "Backed up $FILE ($(du -h "$FILE" | cut -f1)) to $BACKUP_REMOTE"
