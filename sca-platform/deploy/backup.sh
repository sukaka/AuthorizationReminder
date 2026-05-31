#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/data/sca/backups}"
POSTGRES_SERVICE="${POSTGRES_SERVICE:-sca-postgres}"
POSTGRES_DB="${POSTGRES_DB:-juxin_sca}"
POSTGRES_USER="${POSTGRES_USER:-sca_user}"
STAMP="$(date -u +%Y%m%d%H%M%S)"

mkdir -p "$BACKUP_DIR"
docker compose exec -T "$POSTGRES_SERVICE" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/sca-db-$STAMP.sql"
tar -czf "$BACKUP_DIR/sca-files-$STAMP.tar.gz" -C /data/sca uploads reports sbom 2>/dev/null || true
find "$BACKUP_DIR" -type f -mtime +30 -delete

echo "backup completed: $BACKUP_DIR"
