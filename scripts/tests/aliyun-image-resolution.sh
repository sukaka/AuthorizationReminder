#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RESOLVER="${ROOT_DIR}/scripts/deploy/resolve-image-sources.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

OUT_FILE="${TMP_DIR}/images.env"
BIN_DIR="${TMP_DIR}/bin"
mkdir -p "${BIN_DIR}"

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
exit 1
SH
chmod +x "${BIN_DIR}/docker"

PATH="${BIN_DIR}:$PATH" \
ALIYUN_DOCKERHUB_PREFIX="registry.cn-hangzhou.aliyuncs.com/acr-mirror/library" \
"${RESOLVER}" "${OUT_FILE}"

if ! grep -q '^NODE_20_BOOKWORM_IMAGE=registry.cn-hangzhou.aliyuncs.com/acr-mirror/library/node:20-bookworm$' "${OUT_FILE}"; then
  echo "expected NODE_20_BOOKWORM_IMAGE to prefer aliyun candidate" >&2
  exit 1
fi

if ! grep -q '^MYSQL_8_IMAGE=mysql:8.0$' "${OUT_FILE}"; then
  echo "expected MYSQL_8_IMAGE to fall back to official image" >&2
  exit 1
fi

echo "aliyun image resolution: ok"
