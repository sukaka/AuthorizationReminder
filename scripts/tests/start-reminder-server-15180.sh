#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/scripts/deploy/start-reminder-server-15180.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
ENV_FILE="${TMP_DIR}/test.env"
IMAGE_ENV_FILE="${TMP_DIR}/images.env"
COMBINED_ENV_FILE="${TMP_DIR}/compose.env"
LOG_FILE="${TMP_DIR}/docker.log"
mkdir -p "${BIN_DIR}"

cat > "${ENV_FILE}" <<'EOF'
MYSQL_IMAGE=custom.registry/mysql:8.0
PUBLIC_HOST=8.141.81.201
EOF

cat > "${BIN_DIR}/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "manifest" ] && [ "$2" = "inspect" ]; then
  exit 1
fi

if [ "$1" = "compose" ]; then
  printf 'docker %s\n' "$*" >> "$TEST_LOG_FILE"
  exit 0
fi

exit 1
SH
chmod +x "${BIN_DIR}/docker"

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ENV_FILE="${ENV_FILE}" \
IMAGE_ENV_FILE="${IMAGE_ENV_FILE}" \
COMBINED_ENV_FILE="${COMBINED_ENV_FILE}" \
bash "${SCRIPT_PATH}" start

if ! grep -q 'AUTH_HOST_PORT="${AUTH_HOST_PORT:-15180}"' "${SCRIPT_PATH}"; then
  echo 'expected start script to default auth host port to 15180' >&2
  exit 1
fi

if ! grep -q '"${AUTH_HOST_PORT:-5180}:5180"' "${ROOT_DIR}/docker-compose.yml"; then
  echo 'expected base compose auth port to be configurable' >&2
  exit 1
fi

if ! grep -q ' -f docker-compose.yml -f scripts/deploy/docker-compose.reminder-15180.yml up -d mysql auth api web$' "${LOG_FILE}"; then
  echo 'expected start script to use reminder 15180 override and only reminder services' >&2
  exit 1
fi

: > "${LOG_FILE}"

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ENV_FILE="${ENV_FILE}" \
IMAGE_ENV_FILE="${IMAGE_ENV_FILE}" \
COMBINED_ENV_FILE="${COMBINED_ENV_FILE}" \
bash "${SCRIPT_PATH}" rebuild

if ! grep -q ' -f docker-compose.yml -f scripts/deploy/docker-compose.reminder-15180.yml build auth api web$' "${LOG_FILE}"; then
  echo 'expected rebuild to build auth/api/web' >&2
  exit 1
fi

if ! grep -q ' -f docker-compose.yml -f scripts/deploy/docker-compose.reminder-15180.yml up -d mysql auth api web$' "${LOG_FILE}"; then
  echo 'expected rebuild to start only reminder services' >&2
  exit 1
fi

echo 'start reminder server 15180: ok'
