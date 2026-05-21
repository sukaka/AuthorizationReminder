#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "${SCRIPT_DIR}/../.." && pwd)
COMPOSE_WRAPPER="${SCRIPT_DIR}/docker-compose-aliyun.sh"
SERVICES=(mysql auth train-exam-api web-train-exam train-exam-onlyoffice)
BUILD_SERVICES=(auth train-exam-api web-train-exam)
export AUTH_HOST_PORT="${AUTH_HOST_PORT:-5180}"

usage() {
  cat <<'EOF'
Usage:
  scripts/deploy/start-train-exam-macmini-5180.sh [start|rebuild|status|logs]

Commands:
  start    Start only the training/exam stack on Mac mini ports. Default.
  rebuild  Build auth/train-exam-api/web-train-exam, then start the stack.
  status   Show compose status for the training/exam stack.
  logs     Follow logs for auth/train-exam-api/web-train-exam/train-exam-onlyoffice.

External ports:
  auth portal: 5180 -> 5180
  train exam api: 5188 -> 5188
  train exam web: 18087 -> 80
EOF
}

run_compose() {
  "${COMPOSE_WRAPPER}" -f docker-compose.yml "$@"
}

cd "${ROOT_DIR}"

command="${1:-start}"
case "${command}" in
  start)
    run_compose up -d "${SERVICES[@]}"
    ;;
  rebuild)
    run_compose build "${BUILD_SERVICES[@]}"
    run_compose up -d "${SERVICES[@]}"
    ;;
  status)
    run_compose ps "${SERVICES[@]}"
    ;;
  logs)
    run_compose logs -f auth train-exam-api web-train-exam train-exam-onlyoffice
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
