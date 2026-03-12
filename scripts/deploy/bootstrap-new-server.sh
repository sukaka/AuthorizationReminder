#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
COMPOSE_WRAPPER="${ROOT_DIR}/scripts/deploy/docker-compose-aliyun.sh"
ENV_FILE="${ROOT_DIR}/.env"
ENV_TEMPLATE="${ROOT_DIR}/.env.example"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_file_exec() {
  [ -x "$1" ] || {
    echo "missing required executable: $1" >&2
    exit 1
  }
}

current_value() {
  local key="$1"
  local line
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)
  [ -n "$line" ] || return 1
  printf '%s' "${line#*=}" | tr -d '\r'
}

is_placeholder() {
  local value="$1"
  [ -z "$value" ] && return 0
  case "$value" in
    change_me_*|replace-with-*|dev-secret-change-me|faq-onlyoffice-jwt-change-me|tender-onlyoffice-jwt-change-me|tender-audit-signing-key-change-me|tender-config-secret-change-me-32chars)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

upsert_env() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file=$(mktemp)
  awk -v target="$key" -v val="$value" '
  BEGIN { done=0 }
  $0 ~ ("^" target "=") {
    print target "=" val
    done=1
    next
  }
  { print }
  END {
    if (!done) print target "=" val
  }
  ' "$ENV_FILE" > "$tmp_file"
  mv "$tmp_file" "$ENV_FILE"
}

gen_hex() {
  openssl rand -hex 32
}

gen_pass() {
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 32
}

ensure_value() {
  local key="$1"
  local mode="$2"
  local existing=""
  existing=$(current_value "$key" 2>/dev/null || true)
  if ! is_placeholder "$existing"; then
    return 0
  fi

  case "$mode" in
    pass)
      upsert_env "$key" "$(gen_pass)"
      ;;
    hex)
      upsert_env "$key" "$(gen_hex)"
      ;;
    required_plain)
      local provided=""
      provided="${!key:-}"
      if is_placeholder "$provided"; then
        echo "required env ${key} is missing. export ${key}=<your-login-password> and rerun." >&2
        exit 1
      fi
      upsert_env "$key" "$provided"
      ;;
    host_or_localhost)
      local provided=""
      provided="${!key:-}"
      if is_placeholder "$provided"; then
        upsert_env "$key" "localhost"
      else
        upsert_env "$key" "$provided"
      fi
      ;;
    *)
      echo "unknown mode: $mode" >&2
      exit 1
      ;;
  esac
}

wait_http() {
  local label="$1"
  local url="$2"
  local retries="${3:-60}"
  local delay="${4:-2}"
  local i
  for ((i=1; i<=retries; i+=1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "${label}: ok"
      return 0
    fi
    sleep "$delay"
  done
  echo "${label}: failed" >&2
  return 1
}

wait_cmdb() {
  local retries="${1:-60}"
  local delay="${2:-2}"
  local i
  for ((i=1; i<=retries; i+=1)); do
    local cmdb_id
    cmdb_id=$("${COMPOSE_WRAPPER}" -f "${ROOT_DIR}/docker-compose.yml" ps -q cmdb 2>/dev/null || true)
    if [ -n "$cmdb_id" ] && docker exec "$cmdb_id" /bin/sh -lc 'wget -qO- http://127.0.0.1:8088/healthz' >/dev/null 2>&1; then
      echo "cmdb: ok"
      return 0
    fi
    sleep "$delay"
  done
  echo "cmdb: failed" >&2
  return 1
}

main() {
  require_cmd docker
  require_cmd openssl
  require_cmd awk
  require_cmd curl
  require_file_exec "${COMPOSE_WRAPPER}"

  cd "$ROOT_DIR"
  [ -f "$ENV_TEMPLATE" ] || {
    echo ".env.example not found at $ENV_TEMPLATE" >&2
    exit 1
  }
  [ -f "$ENV_FILE" ] || cp "$ENV_TEMPLATE" "$ENV_FILE"

  ensure_value MYSQL_ROOT_PASSWORD pass
  ensure_value MYSQL_SHARED_APP_PASSWORD pass
  ensure_value AUTH_MYSQL_PASSWORD pass
  ensure_value AUTH_JWT_SECRET hex
  ensure_value AUTH_AUDIT_SIGNING_KEY hex
  ensure_value AUTH_CONFIG_SECRET_KEY hex
  ensure_value AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD required_plain
  ensure_value PUBLIC_HOST host_or_localhost
  ensure_value FAQ_MYSQL_PASSWORD pass
  ensure_value FAQ_DOC_EDITOR_JWT_SECRET hex
  ensure_value SEC_IMPL_MYSQL_PASSWORD pass
  ensure_value TENDER_MYSQL_PASSWORD pass
  ensure_value TRAIN_EXAM_MYSQL_PASSWORD pass
  ensure_value TRAIN_EXAM_AUDIT_SIGNING_KEY hex
  ensure_value TRAIN_EXAM_DOC_EDITOR_JWT_SECRET hex
  ensure_value CMDB_MYSQL_PASSWORD pass

  "${COMPOSE_WRAPPER}" config >/tmp/codex-compose-bootstrap.yml
  "${COMPOSE_WRAPPER}" up -d mysql
  "${COMPOSE_WRAPPER}" up -d --build

  wait_http auth "http://127.0.0.1:5180/health"
  wait_http reminder "http://127.0.0.1:5179/api/health"
  wait_http ticketing "http://127.0.0.1:5182/health"
  wait_http inventory "http://127.0.0.1:5183/api/health"
  wait_http device-flow "http://127.0.0.1:5184/api/health"
  wait_http sec-impl "http://127.0.0.1:5185/api/health"
  wait_http faq "http://127.0.0.1:5186/api/health"
  wait_http train-exam "http://127.0.0.1:5188/api/health"
  wait_cmdb

  "${COMPOSE_WRAPPER}" ps
}

main "$@"
