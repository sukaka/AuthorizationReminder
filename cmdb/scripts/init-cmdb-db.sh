#!/usr/bin/env sh
set -eu

require_env() {
  key="$1"
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "$key is required" >&2
    exit 1
  fi
}

require_env MYSQL_HOST
require_env MYSQL_PORT
require_env MYSQL_ROOT_PASSWORD
require_env CMDB_MYSQL_PASSWORD

MYSQL_BIN="${MYSQL_BIN:-mysql}"
INIT_SQL_PATH="${INIT_SQL_PATH:-/migrations/001_init_cmdb.sql}"
MYSQL_WAIT_RETRIES="${MYSQL_WAIT_RETRIES:-60}"
MYSQL_WAIT_INTERVAL_SEC="${MYSQL_WAIT_INTERVAL_SEC:-2}"

mysql_exec() {
  "$MYSQL_BIN" \
    --default-character-set=utf8mb4 \
    -h"$MYSQL_HOST" \
    -P"$MYSQL_PORT" \
    -uroot \
    -p"$MYSQL_ROOT_PASSWORD" \
    "$@"
}

attempt=1
while [ "$attempt" -le "$MYSQL_WAIT_RETRIES" ]; do
  if mysql_exec -e "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq "$MYSQL_WAIT_RETRIES" ]; then
    echo "mysql is not ready after ${MYSQL_WAIT_RETRIES} attempts" >&2
    exit 1
  fi
  echo "waiting for mysql..."
  sleep "$MYSQL_WAIT_INTERVAL_SEC"
  attempt=$((attempt + 1))
done

mysql_exec <"$INIT_SQL_PATH"

TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT
cat >"$TMP_SQL" <<SQL
CREATE USER IF NOT EXISTS 'cmdb_user'@'%' IDENTIFIED BY '${CMDB_MYSQL_PASSWORD}';
ALTER USER 'cmdb_user'@'%' IDENTIFIED BY '${CMDB_MYSQL_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON cmdb.* TO 'cmdb_user'@'%';
FLUSH PRIVILEGES;
SQL

mysql_exec <"$TMP_SQL"

echo "cmdb mysql initialized"
