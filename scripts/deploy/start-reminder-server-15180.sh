#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
COMPOSE_WRAPPER="${SCRIPT_DIR}/docker-compose-aliyun.sh"
OVERRIDE_FILE="scripts/deploy/docker-compose.reminder-15180.yml"
SERVICES=(mysql auth api web)
export AUTH_HOST_PORT="${AUTH_HOST_PORT:-15180}"

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy/start-reminder-server-15180.sh [start|rebuild|status|logs]

Commands:
  start    Start only the reminder stack on server ports. Default.
  rebuild  Build auth/api/web, then start the reminder stack.
  status   Show compose status for the reminder stack.
  logs     Follow logs for auth/api/web.

External ports:
  auth portal: 15180 -> 5180
  reminder api: 5179 -> 5179
  reminder web: 18080 -> 80
EOF
}

run_compose() {
  "${COMPOSE_WRAPPER}" -f docker-compose.yml -f "${OVERRIDE_FILE}" "$@"
}

cd "${ROOT_DIR}"

command="${1:-start}"
case "${command}" in
  start)
    run_compose up -d "${SERVICES[@]}"
    ;;
  rebuild)
    run_compose build auth api web
    run_compose up -d "${SERVICES[@]}"
    ;;
  status)
    run_compose ps "${SERVICES[@]}"
    ;;
  logs)
    run_compose logs -f auth api web
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
