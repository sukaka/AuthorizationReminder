#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SCRIPT_PATH="${ROOT_DIR}/scripts/deploy/bootstrap-full-server.sh"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
REPO_DIR="${TMP_DIR}/repo"
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

PATH="${BIN_DIR}:$PATH" \
TEST_LOG_FILE="${LOG_FILE}" \
ALIYUN_MIRROR_URL='https://example.mirror.aliyuncs.com' \
AUTH_BUILTIN_ACCOUNT_DEFAULT_PASSWORD='Password123!' \
PUBLIC_HOST='8.141.81.201' \
BOOTSTRAP_REPO_DIR="${REPO_DIR}" \
BOOTSTRAP_BRANCH='codex/5.7.6' \
BOOTSTRAP_REPO_URL='https://example.invalid/repo.git' \
BOOTSTRAP_DOCKER_CONFIG_DIR="${DOCKER_DIR}" \
bash "${SCRIPT_PATH}"

if ! grep -q 'https://example.mirror.aliyuncs.com' "${DOCKER_DIR}/daemon.json"; then
  echo 'expected mirror URL in generated daemon.json' >&2
  exit 1
fi

if ! grep -q '^git clone -b codex/5.7.6 https://example.invalid/repo.git '"${REPO_DIR}"'$' "${LOG_FILE}"; then
  echo 'expected branch clone command' >&2
  exit 1
fi

if ! grep -q '^bootstrap-new-server Password123! 8.141.81.201$' "${LOG_FILE}"; then
  echo 'expected bootstrap-new-server invocation with exported password and public host' >&2
  exit 1
fi

echo 'bootstrap-full-server: ok'
