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
ALIYUN_DOCKERHUB_PREFIX=registry.cn-hangzhou.aliyuncs.com/acr-mirror/library
EOF

cat > "${BIN_DIR}/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "manifest" ] && [ "$2" = "inspect" ]; then
  case "$3" in
    registry.cn-hangzhou.aliyuncs.com/acr-mirror/library/node:20-bookworm)
      exit 0
      ;;
    *)
      exit 1
      ;;
  esac
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
bash "${SCRIPT_PATH}" config

if ! grep -q '^MYSQL_IMAGE=custom.registry/mysql:8.0$' "${IMAGE_ENV_FILE}"; then
  echo 'expected generated image env to honor explicit MYSQL_IMAGE override' >&2
  exit 1
fi

if ! grep -q '^NODE_20_BOOKWORM_IMAGE=registry.cn-hangzhou.aliyuncs.com/acr-mirror/library/node:20-bookworm$' "${IMAGE_ENV_FILE}"; then
  echo 'expected generated image env to honor ALIYUN_DOCKERHUB_PREFIX from env file' >&2
  exit 1
fi

if ! grep -q '^MYSQL_IMAGE=custom.registry/mysql:8.0$' "${COMBINED_ENV_FILE}"; then
  echo 'expected combined env file to carry explicit MYSQL_IMAGE override' >&2
  exit 1
fi

if ! grep -q '^docker compose --env-file '"${COMBINED_ENV_FILE//\//\\/}"' config$' "${LOG_FILE}"; then
  echo 'expected docker compose invocation with generated env file' >&2
  exit 1
fi

echo 'docker-compose-aliyun env priority: ok'
