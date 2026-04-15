#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/scripts/deploy/docker-compose-aliyun.sh"
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
bash "${SCRIPT_PATH}" start train-exam-api web-train-exam

if ! grep -q '^docker compose --env-file '"${COMBINED_ENV_FILE//\//\\/}"' up -d train-exam-api web-train-exam$' "${LOG_FILE}"; then
  echo 'expected start alias to run docker compose up -d with services' >&2
  exit 1
fi

: > "${LOG_FILE}"

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ENV_FILE="${ENV_FILE}" \
IMAGE_ENV_FILE="${IMAGE_ENV_FILE}" \
COMBINED_ENV_FILE="${COMBINED_ENV_FILE}" \
bash "${SCRIPT_PATH}" rebuild train-exam-api web-train-exam

if ! grep -q '^docker compose --env-file '"${COMBINED_ENV_FILE//\//\\/}"' build train-exam-api web-train-exam$' "${LOG_FILE}"; then
  echo 'expected rebuild alias to run docker compose build first' >&2
  exit 1
fi

if ! grep -q '^docker compose --env-file '"${COMBINED_ENV_FILE//\//\\/}"' up -d train-exam-api web-train-exam$' "${LOG_FILE}"; then
  echo 'expected rebuild alias to run docker compose up -d after build' >&2
  exit 1
fi

echo 'docker-compose-aliyun commands: ok'
