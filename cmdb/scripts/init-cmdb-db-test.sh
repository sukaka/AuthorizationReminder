#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/cmdb/scripts/init-cmdb-db.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAKE_MYSQL="$TMP_DIR/mysql"
cat >"$FAKE_MYSQL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${MYSQL_TEST_LOG_DIR:?}"
COUNTER_FILE="$LOG_DIR/counter"
if [[ ! -f "$COUNTER_FILE" ]]; then
  echo 0 >"$COUNTER_FILE"
fi

counter="$(cat "$COUNTER_FILE")"
counter="$((counter + 1))"
printf '%s' "$counter" >"$COUNTER_FILE"

printf 'call:%s\n' "$*" >>"$LOG_DIR/calls.log"
cat >"$LOG_DIR/stdin-${counter}.sql" || true
EOF
chmod +x "$FAKE_MYSQL"

INIT_SQL="$TMP_DIR/001_init_cmdb.sql"
cat >"$INIT_SQL" <<'EOF'
CREATE DATABASE IF NOT EXISTS cmdb;
EOF

MYSQL_TEST_LOG_DIR="$TMP_DIR" \
MYSQL_BIN="$FAKE_MYSQL" \
MYSQL_HOST="mysql" \
MYSQL_PORT="3306" \
MYSQL_ROOT_PASSWORD="root-secret" \
CMDB_MYSQL_PASSWORD="runtime-pass@1" \
INIT_SQL_PATH="$INIT_SQL" \
MYSQL_WAIT_RETRIES="1" \
MYSQL_WAIT_INTERVAL_SEC="0" \
bash "$SCRIPT_PATH"

grep -F -- "-hmysql" "$TMP_DIR/calls.log" >/dev/null
grep -F -- "-P3306" "$TMP_DIR/calls.log" >/dev/null
grep -F -- "-uroot" "$TMP_DIR/calls.log" >/dev/null
grep -F -- "-proot-secret" "$TMP_DIR/calls.log" >/dev/null
grep -F -- "-e SELECT 1" "$TMP_DIR/calls.log" >/dev/null
grep -F "CREATE USER IF NOT EXISTS 'cmdb_user'@'%'" "$TMP_DIR"/stdin-3.sql >/dev/null
grep -F "ALTER USER 'cmdb_user'@'%'" "$TMP_DIR"/stdin-3.sql >/dev/null
grep -F "GRANT SELECT, INSERT, UPDATE, DELETE ON cmdb.* TO 'cmdb_user'@'%'" "$TMP_DIR"/stdin-3.sql >/dev/null
grep -F "IDENTIFIED BY 'runtime-pass@1'" "$TMP_DIR"/stdin-3.sql >/dev/null

echo "init-cmdb-db test passed"
