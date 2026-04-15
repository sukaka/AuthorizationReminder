#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
ENV_SOURCE="${ENV_FILE:-}"
IMAGE_ENV_FILE="${IMAGE_ENV_FILE:-${ROOT_DIR}/.env.images}"
COMBINED_ENV_FILE="${COMBINED_ENV_FILE:-${ROOT_DIR}/.env.compose.generated}"
DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"

if [ -z "$ENV_SOURCE" ]; then
  if [ -f "${ROOT_DIR}/.env" ]; then
    ENV_SOURCE="${ROOT_DIR}/.env"
  else
    ENV_SOURCE="${ROOT_DIR}/.env.example"
  fi
fi

# Export explicit values from the selected env file before resolving images so
# user-provided aliases and mirror prefixes take precedence over generated defaults.
if [ -f "$ENV_SOURCE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_SOURCE"
  set +a
fi

run_compose() {
  docker compose --env-file "$COMBINED_ENV_FILE" "$@"
}

"${SCRIPT_DIR}/resolve-image-sources.sh" "$IMAGE_ENV_FILE"

: > "$COMBINED_ENV_FILE"
cat "$IMAGE_ENV_FILE" >> "$COMBINED_ENV_FILE"
printf '\n' >> "$COMBINED_ENV_FILE"
if [ -f "$ENV_SOURCE" ]; then
  cat "$ENV_SOURCE" >> "$COMBINED_ENV_FILE"
  printf '\n' >> "$COMBINED_ENV_FILE"
fi

cd "$ROOT_DIR"
export DOCKER_BUILDKIT
export COMPOSE_DOCKER_CLI_BUILD

COMMAND="${1:-}"
case "$COMMAND" in
  start)
    shift
    exec docker compose --env-file "$COMBINED_ENV_FILE" up -d "$@"
    ;;
  rebuild)
    shift
    run_compose build "$@"
    exec docker compose --env-file "$COMBINED_ENV_FILE" up -d "$@"
    ;;
  *)
    exec docker compose --env-file "$COMBINED_ENV_FILE" "$@"
    ;;
esac
