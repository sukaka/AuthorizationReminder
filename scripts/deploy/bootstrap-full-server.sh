#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_REPO_DIR="${BOOTSTRAP_REPO_DIR:-/root/AuthorizationReminder-codex-4.4.2}"
BOOTSTRAP_BRANCH="${BOOTSTRAP_BRANCH:-codex/4.4.2}"
BOOTSTRAP_REPO_URL="${BOOTSTRAP_REPO_URL:-https://github.com/sukaka/AuthorizationReminder.git}"
BOOTSTRAP_DOCKER_CONFIG_DIR="${BOOTSTRAP_DOCKER_CONFIG_DIR:-/etc/docker}"
BOOTSTRAP_DOCKER_DAEMON_JSON="${BOOTSTRAP_DOCKER_DAEMON_JSON:-${BOOTSTRAP_DOCKER_CONFIG_DIR}/daemon.json}"
ALIYUN_MIRROR_URL="${ALIYUN_MIRROR_URL:-}"
AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD="${AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing required command: $1" >&2
    exit 1
  }
}

require_env() {
  local key="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "required env ${key} is missing" >&2
    exit 1
  fi
}

require_file_exec() {
  [ -x "$1" ] || {
    echo "missing required executable: $1" >&2
    exit 1
  }
}

configure_docker_mirror() {
  mkdir -p "$BOOTSTRAP_DOCKER_CONFIG_DIR"
  cat > "$BOOTSTRAP_DOCKER_DAEMON_JSON" <<JSON
{
  "registry-mirrors": ["${ALIYUN_MIRROR_URL}"]
}
JSON
  systemctl daemon-reload
  systemctl restart docker
}

sync_repo() {
  if [ ! -d "$BOOTSTRAP_REPO_DIR/.git" ]; then
    git clone -b "$BOOTSTRAP_BRANCH" "$BOOTSTRAP_REPO_URL" "$BOOTSTRAP_REPO_DIR"
    return 0
  fi

  cd "$BOOTSTRAP_REPO_DIR"
  git fetch origin
  git checkout "$BOOTSTRAP_BRANCH"
  git pull --ff-only origin "$BOOTSTRAP_BRANCH"
}

run_repo_bootstrap() {
  cd "$BOOTSTRAP_REPO_DIR"
  chmod +x scripts/deploy/bootstrap-new-server.sh scripts/deploy/docker-compose-aliyun.sh scripts/deploy/resolve-image-sources.sh
  require_file_exec "$BOOTSTRAP_REPO_DIR/scripts/deploy/bootstrap-new-server.sh"
  export AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD
  export PUBLIC_HOST
  "$BOOTSTRAP_REPO_DIR/scripts/deploy/bootstrap-new-server.sh"
}

main() {
  require_cmd git
  require_cmd docker
  require_cmd systemctl
  require_env ALIYUN_MIRROR_URL "$ALIYUN_MIRROR_URL"
  require_env AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD "$AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD"
  require_env PUBLIC_HOST "$PUBLIC_HOST"

  configure_docker_mirror
  sync_repo
  run_repo_bootstrap
}

main "$@"
