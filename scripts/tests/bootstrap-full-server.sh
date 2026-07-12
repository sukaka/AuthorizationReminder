#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/scripts/deploy/bootstrap-full-server.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
REPO_DIR="${TMP_DIR}/repo"
OVERRIDE_REPO_DIR="${TMP_DIR}/repo-override"
DOCKER_DIR="${TMP_DIR}/docker"
LOG_FILE="${TMP_DIR}/calls.log"
mkdir -p "${BIN_DIR}" "${DOCKER_DIR}"

cat > "${BIN_DIR}/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$TEST_LOG_FILE"
if [ "$1" = "clone" ]; then
  branch="$3"
  repo_url="$4"
  target_dir="$5"
  mkdir -p "$target_dir/scripts/deploy"
  cat > "$target_dir/scripts/deploy/bootstrap-new-server.sh" <<'INNER'
#!/usr/bin/env bash
set -euo pipefail
printf 'bootstrap-new-server %s %s\n' "$AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD" "$PUBLIC_HOST" >> "$TEST_LOG_FILE"
INNER
  chmod +x "$target_dir/scripts/deploy/bootstrap-new-server.sh"
  cat > "$target_dir/scripts/deploy/docker-compose-aliyun.sh" <<'INNER'
#!/usr/bin/env bash
exit 0
INNER
  chmod +x "$target_dir/scripts/deploy/docker-compose-aliyun.sh"
  cat > "$target_dir/scripts/deploy/resolve-image-sources.sh" <<'INNER'
#!/usr/bin/env bash
exit 0
INNER
  chmod +x "$target_dir/scripts/deploy/resolve-image-sources.sh"
  exit 0
fi
exit 0
SH
chmod +x "${BIN_DIR}/git"

cat > "${BIN_DIR}/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$TEST_LOG_FILE"
exit 0
SH
chmod +x "${BIN_DIR}/docker"

cat > "${BIN_DIR}/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'systemctl %s\n' "$*" >> "$TEST_LOG_FILE"
exit 0
SH
chmod +x "${BIN_DIR}/systemctl"

PLACEHOLDER_DOCKER_DIR="${TMP_DIR}/docker-placeholder"
mkdir -p "${PLACEHOLDER_DOCKER_DIR}"
if PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ALIYUN_MIRROR_URL='替换成你的阿里云镜像加速器地址' \
AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD='Password123!' \
PUBLIC_HOST='8.141.81.201' \
BOOTSTRAP_REPO_DIR="${TMP_DIR}/repo-placeholder" \
BOOTSTRAP_DOCKER_CONFIG_DIR="${PLACEHOLDER_DOCKER_DIR}" \
bash "${SCRIPT_PATH}" >/dev/null 2>"${TMP_DIR}/placeholder.err"; then
  echo 'expected placeholder ALIYUN_MIRROR_URL to fail' >&2
  exit 1
fi

if [ -f "${PLACEHOLDER_DOCKER_DIR}/daemon.json" ]; then
  echo 'expected placeholder ALIYUN_MIRROR_URL not to write daemon.json' >&2
  exit 1
fi

if ! grep -q 'ALIYUN_MIRROR_URL' "${TMP_DIR}/placeholder.err"; then
  echo 'expected placeholder failure to mention ALIYUN_MIRROR_URL' >&2
  exit 1
fi

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ALIYUN_MIRROR_URL='https://example.mirror.aliyuncs.com' \
AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD='Password123!' \
PUBLIC_HOST='8.141.81.201' \
BOOTSTRAP_REPO_DIR="${REPO_DIR}" \
BOOTSTRAP_REPO_URL='https://example.invalid/repo.git' \
BOOTSTRAP_DOCKER_CONFIG_DIR="${DOCKER_DIR}" \
bash "${SCRIPT_PATH}"

if ! grep -q 'https://example.mirror.aliyuncs.com' "${DOCKER_DIR}/daemon.json"; then
  echo 'expected mirror URL in generated daemon.json' >&2
  exit 1
fi

if ! grep -q '^git clone -b main https://example.invalid/repo.git '"${REPO_DIR}"'$' "${LOG_FILE}"; then
  echo 'expected stable default branch clone command' >&2
  exit 1
fi

if ! grep -q 'BOOTSTRAP_REPO_DIR="${BOOTSTRAP_REPO_DIR:-/root/AuthorizationReminder}"' "${SCRIPT_PATH}"; then
  echo 'expected stable default repository directory' >&2
  exit 1
fi

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ALIYUN_MIRROR_URL='https://example.mirror.aliyuncs.com' \
AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD='Password123!' \
PUBLIC_HOST='8.141.81.201' \
BOOTSTRAP_REPO_DIR="${OVERRIDE_REPO_DIR}" \
BOOTSTRAP_BRANCH='release/custom' \
BOOTSTRAP_REPO_URL='https://example.invalid/repo.git' \
BOOTSTRAP_DOCKER_CONFIG_DIR="${DOCKER_DIR}" \
bash "${SCRIPT_PATH}"

if ! grep -q '^git clone -b release/custom https://example.invalid/repo.git '"${OVERRIDE_REPO_DIR}"'$' "${LOG_FILE}"; then
  echo 'expected explicit branch override clone command' >&2
  exit 1
fi

if ! grep -q '^bootstrap-new-server Password123! 8.141.81.201$' "${LOG_FILE}"; then
  echo 'expected bootstrap-new-server invocation with exported password and public host' >&2
  exit 1
fi

echo 'bootstrap-full-server: ok'
