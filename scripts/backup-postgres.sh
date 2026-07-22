#!/usr/bin/env bash
# Postgres daily backup (PRD §A4: Postgres 每日备份).
# Dumps the nanosparks database to a timestamped file, optionally uploads to S3/MinIO.
# Run via cron daily (e.g., 02:00 Asia/Shanghai).
#
# Usage: DATABASE_URL=postgresql://... ./scripts/backup-postgres.sh
# Env: BACKUP_S3_BUCKET (optional — uploads to S3 if set)
#      BACKUP_RETENTION_DAYS (default 7 — delete local backups older than N days)

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/tmp/nanosparks-backups}"
BACKUP_FILE="${BACKUP_DIR}/nanosparks_${TIMESTAMP}.sql.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting Postgres backup → $BACKUP_FILE"

# Dump + gzip in one pipe (no intermediate file).
pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$BACKUP_FILE"

echo "[$(date)] Backup complete: $(du -h "$BACKUP_FILE" | cut -f1)"

# Optionally upload to S3/MinIO.
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[$(date)] Uploading to S3: s3://$BACKUP_S3_BUCKET/$(basename "$BACKUP_FILE")"
  if command -v aws &> /dev/null; then
    S3_ENDPOINT="${S3_ENDPOINT:-}" aws s3 cp "$BACKUP_FILE" "s3://$BACKUP_S3_BUCKET/$(basename "$BACKUP_FILE")" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"}
    echo "[$(date)] S3 upload complete"
  else
    echo "[WARN] aws CLI not found — skipping S3 upload"
  fi
fi

# Delete local backups older than retention.
find "$BACKUP_DIR" -name "nanosparks_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Cleaned backups older than $RETENTION_DAYS days"
echo "[$(date)] Done."
