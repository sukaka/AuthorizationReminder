#!/usr/bin/env bash
set -euo pipefail

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "$COMMON_DIR/.." && pwd)"
ROOT_DIR="$(cd "$TESTS_DIR/../.." && pwd)"
LEGACY_BUILTIN_PASSWORD="Dm1vbnqsILIVjUa5sWixBFos60bKdEKC"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

step() {
  printf '\n[%s] >>> %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '[ERROR] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "缺少依赖命令: $cmd"
}

run_cmd() {
  local title="$1"
  shift
  step "$title"
  "$@"
}

compose_up() {
  local services=("$@")
  if [[ "${SKIP_COMPOSE_UP:-0}" == "1" ]]; then
    log "跳过容器启动（SKIP_COMPOSE_UP=1），默认复用已有环境"
    return
  fi
  require_cmd docker
  local args=(up -d)
  if [[ "${COMPOSE_BUILD:-1}" == "1" ]]; then
    args+=(--build)
  fi
  args+=("${services[@]}")
  step "docker compose 启动: ${services[*]}"
  (
    cd "$ROOT_DIR"
    docker compose "${args[@]}"
  )
}

wait_http_status() {
  local url="$1"
  local expected_csv="$2"
  local name="${3:-$url}"
  local timeout="${4:-180}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ ",$expected_csv," == *",$code,"* ]]; then
      log "$name 已就绪（HTTP ${code}）"
      return
    fi
    local now_ts
    now_ts="$(date +%s)"
    if (( now_ts - start_ts >= timeout )); then
      fail "$name 等待超时（${timeout}s），最后状态: HTTP $code，URL: $url"
    fi
    sleep 2
  done
}

run_node_check() {
  local relative_path="$1"
  run_cmd "Node 语法检查: $relative_path" node --check "$ROOT_DIR/$relative_path"
}

npm_has_script() {
  local pkg_dir="$1"
  local script_name="$2"
  node -e '
const fs = require("fs");
const path = require("path");
const pkgPath = path.resolve(process.argv[1], "package.json");
const scriptName = process.argv[2];
let pkg = {};
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
} catch (_err) {
  process.exit(1);
}
process.exit(pkg && pkg.scripts && pkg.scripts[scriptName] ? 0 : 1);
' "$ROOT_DIR/$pkg_dir" "$script_name"
}

run_npm_script_if_exists() {
  local pkg_dir="$1"
  local script_name="$2"
  if npm_has_script "$pkg_dir" "$script_name"; then
    run_cmd "npm --prefix $pkg_dir run $script_name" npm --prefix "$ROOT_DIR/$pkg_dir" run "$script_name"
  else
    log "跳过 npm --prefix $pkg_dir run $script_name（未定义脚本）"
  fi
}

json_field() {
  local field="$1"
  node -e '
const fs = require("fs");
const key = process.argv[1];
let body = "";
try {
  body = fs.readFileSync(0, "utf8");
} catch (_err) {
  body = "";
}
let data = {};
try {
  data = JSON.parse(body || "{}");
} catch (_err) {
  data = {};
}
const value = data[key];
if (value === undefined || value === null) {
  process.stdout.write("");
} else {
  process.stdout.write(String(value));
}
' "$field"
}

build_login_payload() {
  local username="$1"
  local password="$2"
  local captcha_token="${3:-}"
  local captcha_code="${4:-}"

  node -e '
const username = process.argv[1];
const password = process.argv[2];
const captchaToken = process.argv[3] || "";
const captchaCode = process.argv[4] || "";
const payload = { username, password };
if (captchaToken && captchaCode) {
  payload.captchaToken = captchaToken;
  payload.captcha = captchaCode;
}
process.stdout.write(JSON.stringify(payload));
' "$username" "$password" "$captcha_token" "$captcha_code"
}

parse_captcha_code() {
  node -e '
const fs = require("fs");
let body = "";
try {
  body = fs.readFileSync(0, "utf8");
} catch (_err) {
  body = "";
}
let data = {};
try {
  data = JSON.parse(body || "{}");
} catch (_err) {
  data = {};
}
const svg = String(data.svg || "");
const match = svg.match(/<text[^>]*>([^<]+)<\/text>/i);
process.stdout.write(match && match[1] ? match[1].trim() : "");
'
}

login_get_token() {
  local auth_base="$1"
  local username="$2"
  local password="$3"

  local cookie_jar
  cookie_jar="$(mktemp)"

  local csrf_tmp
  csrf_tmp="$(mktemp)"
  local csrf_code
  csrf_code="$(curl -sS -o "$csrf_tmp" -w '%{http_code}' -c "$cookie_jar" "$auth_base/api/auth/csrf")"
  local csrf_body
  csrf_body="$(cat "$csrf_tmp")"
  rm -f "$csrf_tmp"

  if [[ "$csrf_code" != "200" ]]; then
    rm -f "$cookie_jar"
    fail "获取 CSRF 失败（${auth_base}），HTTP ${csrf_code}: ${csrf_body}"
  fi

  local csrf_token
  csrf_token="$(printf '%s' "$csrf_body" | json_field token)"
  if [[ -z "$csrf_token" ]]; then
    rm -f "$cookie_jar"
    fail "CSRF token 为空: $csrf_body"
  fi

  local captcha_token=""
  local captcha_code=""
  local captcha_tmp
  captcha_tmp="$(mktemp)"
  local captcha_http
  captcha_http="$(curl -sS -o "$captcha_tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" "$auth_base/api/auth/captcha")"
  local captcha_body
  captcha_body="$(cat "$captcha_tmp")"
  rm -f "$captcha_tmp"

  if [[ "$captcha_http" == "200" ]]; then
    local captcha_enabled
    captcha_enabled="$(printf '%s' "$captcha_body" | json_field enabled)"
    if [[ "$captcha_enabled" == "true" ]]; then
      captcha_token="$(printf '%s' "$captcha_body" | json_field token)"
      captcha_code="$(printf '%s' "$captcha_body" | parse_captcha_code)"
      if [[ -z "$captcha_token" || -z "$captcha_code" ]]; then
        rm -f "$cookie_jar"
        fail "验证码自动解析失败: $captcha_body"
      fi
    fi
  fi

  local payload
  payload="$(build_login_payload "$username" "$password" "$captcha_token" "$captcha_code")"

  local login_tmp
  login_tmp="$(mktemp)"
  local login_code
  login_code="$(curl -sS -o "$login_tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" -X POST "$auth_base/api/auth/login" -H 'Content-Type: application/json' -H "X-CSRF-Token: $csrf_token" -d "$payload")"
  local login_body
  login_body="$(cat "$login_tmp")"

  rm -f "$login_tmp" "$cookie_jar"

  if [[ "$login_code" != "200" ]]; then
    fail "登录失败（${username}），HTTP ${login_code}: ${login_body}"
  fi

  local mfa_required
  mfa_required="$(printf '%s' "$login_body" | json_field mfaRequired)"
  local mfa_setup_required
  mfa_setup_required="$(printf '%s' "$login_body" | json_field mfaSetupRequired)"
  if [[ "$mfa_required" == "true" ]]; then
    fail "账号 $username 已开启二次验证，无法自动获取 token。请先 export AUTH_TOKEN=..."
  fi
  if [[ "$mfa_setup_required" == "true" ]]; then
    fail "账号 $username 被要求先完成二次验证设置，无法自动获取 token。请先手工完成后 export AUTH_TOKEN=..."
  fi

  local token
  token="$(printf '%s' "$login_body" | json_field token)"
  if [[ -z "$token" ]]; then
    fail "登录未返回 token: $login_body"
  fi

  printf '%s' "$token"
}

auth_login_probe() {
  local auth_base="$1"
  local username="$2"
  local password="$3"

  local cookie_jar
  cookie_jar="$(mktemp)"

  local csrf_tmp
  csrf_tmp="$(mktemp)"
  local csrf_code
  csrf_code="$(curl -sS -o "$csrf_tmp" -w '%{http_code}' -c "$cookie_jar" "$auth_base/api/auth/csrf")"
  local csrf_body
  csrf_body="$(cat "$csrf_tmp")"
  rm -f "$csrf_tmp"

  if [[ "$csrf_code" != "200" ]]; then
    rm -f "$cookie_jar"
    fail "登录探测失败：获取 CSRF 失败，HTTP $csrf_code: $csrf_body"
  fi

  local csrf_token
  csrf_token="$(printf '%s' "$csrf_body" | json_field token)"
  if [[ -z "$csrf_token" ]]; then
    rm -f "$cookie_jar"
    fail "登录探测失败：CSRF token 为空"
  fi

  local captcha_token=""
  local captcha_code=""
  local captcha_tmp
  captcha_tmp="$(mktemp)"
  local captcha_http
  captcha_http="$(curl -sS -o "$captcha_tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" "$auth_base/api/auth/captcha")"
  local captcha_body
  captcha_body="$(cat "$captcha_tmp")"
  rm -f "$captcha_tmp"

  if [[ "$captcha_http" == "200" ]]; then
    local captcha_enabled
    captcha_enabled="$(printf '%s' "$captcha_body" | json_field enabled)"
    if [[ "$captcha_enabled" == "true" ]]; then
      captcha_token="$(printf '%s' "$captcha_body" | json_field token)"
      captcha_code="$(printf '%s' "$captcha_body" | parse_captcha_code)"
      if [[ -z "$captcha_token" || -z "$captcha_code" ]]; then
        rm -f "$cookie_jar"
        fail "登录探测失败：验证码解析失败"
      fi
    fi
  fi

  local payload
  payload="$(build_login_payload "$username" "$password" "$captcha_token" "$captcha_code")"

  local login_tmp
  login_tmp="$(mktemp)"
  local login_code
  login_code="$(curl -sS -o "$login_tmp" -w '%{http_code}' -b "$cookie_jar" -c "$cookie_jar" -X POST "$auth_base/api/auth/login" -H 'Content-Type: application/json' -H "X-CSRF-Token: $csrf_token" -d "$payload")"
  local login_body
  login_body="$(cat "$login_tmp")"

  rm -f "$login_tmp" "$cookie_jar"

  if [[ "$login_code" != "200" ]]; then
    fail "登录探测失败（${username}），HTTP ${login_code}: ${login_body}"
  fi

  local token
  token="$(printf '%s' "$login_body" | json_field token)"
  local mfa_required
  mfa_required="$(printf '%s' "$login_body" | json_field mfaRequired)"
  local mfa_setup_required
  mfa_setup_required="$(printf '%s' "$login_body" | json_field mfaSetupRequired)"

  if [[ -n "$token" ]]; then
    log "登录探测通过：返回 token"
    return
  fi
  if [[ "$mfa_required" == "true" ]]; then
    log "登录探测通过：返回 mfaRequired=true"
    return
  fi
  if [[ "$mfa_setup_required" == "true" ]]; then
    log "登录探测通过：返回 mfaSetupRequired=true"
    return
  fi

  fail "登录探测返回异常（既无 token，也无 mfa 标志）: $login_body"
}

resolve_auth_token() {
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    printf '%s' "$AUTH_TOKEN"
    return
  fi

  local auth_base="${AUTH_BASE:-http://localhost:5180}"
  local username="${ADMIN_LOGIN:-${ADMIN_USERNAME:-admin}}"
  local password="${ADMIN_PASSWORD:-${BUILTIN_PASSWORD:-${BUILTIN_ACCOUNT_DEFAULT_PASSWORD:-$LEGACY_BUILTIN_PASSWORD}}}"

  local token
  token="$(login_get_token "$auth_base" "$username" "$password")"
  export AUTH_TOKEN="$token"
  printf '%s' "$token"
}

resolve_auth_token_for_user() {
  local username="$1"
  local password="$2"
  local auth_base="${AUTH_BASE:-http://localhost:5180}"
  login_get_token "$auth_base" "$username" "$password"
}
