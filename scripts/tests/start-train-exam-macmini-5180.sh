#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/scripts/deploy/start-train-exam-macmini-5180.sh"
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
PUBLIC_HOST=mac-mini.local
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

if ! grep -q 'AUTH_HOST_PORT="${AUTH_HOST_PORT:-5180}"' "${SCRIPT_PATH}"; then
  echo 'expected Mac mini train-exam script to default auth host port to 5180' >&2
  exit 1
fi

if grep -q 'docker-compose.reminder-15180.yml' "${SCRIPT_PATH}"; then
  echo 'expected Mac mini train-exam script not to use reminder 15180 override' >&2
  exit 1
fi

if ! grep -q ' -f docker-compose.yml up -d mysql auth train-exam-api web-train-exam train-exam-onlyoffice$' "${LOG_FILE}"; then
  echo 'expected start to use base compose and only training/exam services' >&2
  exit 1
fi

: > "${LOG_FILE}"

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ENV_FILE="${ENV_FILE}" \
IMAGE_ENV_FILE="${IMAGE_ENV_FILE}" \
COMBINED_ENV_FILE="${COMBINED_ENV_FILE}" \
bash "${SCRIPT_PATH}" rebuild

if ! grep -q ' -f docker-compose.yml build auth train-exam-api web-train-exam$' "${LOG_FILE}"; then
  echo 'expected rebuild to build auth/train-exam-api/web-train-exam' >&2
  exit 1
fi

if ! grep -q ' -f docker-compose.yml up -d mysql auth train-exam-api web-train-exam train-exam-onlyoffice$' "${LOG_FILE}"; then
  echo 'expected rebuild to start only training/exam services' >&2
  exit 1
fi

echo 'start train exam macmini 5180: ok'
