#!/usr/bin/env bash
set -euo pipefail

# The upstream repository is installed as the runtime component of the
# dashi-ppt Skill.  It is intentionally not copied into the Skill wrapper.
REPO_URL="${DASHI_PPT_REPO_URL:-https://github.com/chuspeeism/dashi-ppt-skill.git}"
REVISION="${DASHI_PPT_REVISION:-fdbb145517ea0e289000aef9b7906bcb3e0cd19a}"
INSTALL_DIR="${DASHI_PPT_INSTALL_DIR:-$(pwd)/.local/dashi-ppt-upstream}"

if [[ -e "${INSTALL_DIR}" && ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "Install directory exists but is not a git checkout: ${INSTALL_DIR}" >&2
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --filter=blob:none "${REPO_URL}" "${INSTALL_DIR}"
fi

git -C "${INSTALL_DIR}" fetch --depth=1 origin "${REVISION}"
git -C "${INSTALL_DIR}" checkout --detach "${REVISION}"

PROJECT_DIR="${INSTALL_DIR}/skills/dashi-ppt/project"
if [[ ! -f "${PROJECT_DIR}/package.json" || ! -f "${PROJECT_DIR}/package-lock.json" ]]; then
  echo "Upstream Dashi PPT project is incomplete: ${PROJECT_DIR}" >&2
  exit 1
fi

npm --prefix "${PROJECT_DIR}" ci
mkdir -p "${PROJECT_DIR}/output"

cat <<EOF
Dashi PPT runtime installed.
Set this environment variable for the API process:
DASHI_PPT_RUNTIME_ROOT=${PROJECT_DIR}
EOF
