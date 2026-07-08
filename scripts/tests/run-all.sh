#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMS=(auth reminder ticketing inventory device-flow sec-impl faq tender train-exam prompt-center ai-assistant cmdb)

if (( $# > 0 )); then
  SYSTEMS=("$@")
fi

FAILED=()

for system in "${SYSTEMS[@]}"; do
  script_path="$SCRIPT_DIR/${system}.sh"
  if [[ ! -f "$script_path" ]]; then
    echo "[ERROR] 未找到系统脚本: $script_path" >&2
    FAILED+=("$system")
    continue
  fi

  echo
  echo "============================================================"
  echo "[RUN] $system"
  echo "============================================================"

  if ! bash "$script_path"; then
    FAILED+=("$system")
  fi

done

if (( ${#FAILED[@]} > 0 )); then
  echo
  echo "[FAILED] 以下系统测试失败: ${FAILED[*]}" >&2
  exit 1
fi

echo
echo "[OK] 全部系统测试通过: ${SYSTEMS[*]}"
