#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TARGET="aarch64-apple-darwin"

export AI_ASSISTANT_BUILD_MODE="${AI_ASSISTANT_BUILD_MODE:-lan-test}"
export VITE_AI_ASSISTANT_BUILD_MODE="$AI_ASSISTANT_BUILD_MODE"

DEFAULT_SERVER_ORIGIN="${AI_ASSISTANT_DEFAULT_SERVER_ORIGIN:-}"
UPDATER_ENABLED="${AI_UPDATER_ENABLED:-false}"
UPDATER_URL="${AI_UPDATER_URL:-}"
UPDATER_PUBLIC_KEY="${AI_UPDATER_PUBLIC_KEY:-}"
DRY_RUN="${1:-}"

if [[ ! -t 0 && -z "${CI:-}" ]]; then
  export CI=true
fi

validate_lan_url() {
  local variable_name="$1"
  local raw="$2"
  local exact_origin="$3"
  local value_kind="URL"
  if [[ "$exact_origin" == "true" ]]; then
    value_kind="origin"
  fi
  VALIDATED_URL="$raw" EXACT_ORIGIN="$exact_origin" BUILD_MODE="$AI_ASSISTANT_BUILD_MODE" node -e '
    try {
      const value = process.env.VALIDATED_URL ?? "";
      const url = new URL(value);
      const exactOrigin = process.env.EXACT_ORIGIN === "true";
      const buildMode = process.env.BUILD_MODE;
      const allowsHttp = buildMode === "lan-test" || buildMode === "development";
      const protocolOk = allowsHttp
        ? (url.protocol === "https:" || url.protocol === "http:")
        : url.protocol === "https:";
      const rawExactOrigin = /^https?:\/\/[^/?#]+\/?$/u.test(value);
      const valid = protocolOk
        && url.hostname !== ""
        && url.username === ""
        && url.password === ""
        && !url.hostname.includes("*")
        && url.hash === ""
        && (!exactOrigin || (rawExactOrigin && url.pathname === "/" && url.search === ""));
      process.exit(valid ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' || {
    local protocol_label="HTTPS"
    if [[ "$AI_ASSISTANT_BUILD_MODE" == "lan-test" || "$AI_ASSISTANT_BUILD_MODE" == "development" ]]; then
      protocol_label="HTTP/HTTPS"
    fi
    echo "$variable_name 必须是合法、无凭据的 $protocol_label $value_kind" >&2
    exit 1
  }
}

if [[ -n "$DEFAULT_SERVER_ORIGIN" ]]; then
  validate_lan_url "AI_ASSISTANT_DEFAULT_SERVER_ORIGIN" "$DEFAULT_SERVER_ORIGIN" true
  export AI_ASSISTANT_DEFAULT_SERVER_ORIGIN="$DEFAULT_SERVER_ORIGIN"
else
  unset AI_ASSISTANT_DEFAULT_SERVER_ORIGIN
fi

case "$UPDATER_ENABLED" in
  true)
    validate_lan_url "AI_UPDATER_URL" "$UPDATER_URL" false
    [[ -n "${UPDATER_PUBLIC_KEY//[[:space:]]/}" ]] || {
      echo 'AI_UPDATER_PUBLIC_KEY 在启用自动更新时不能为空' >&2
      exit 1
    }
    export AI_UPDATER_URL="$UPDATER_URL"
    export AI_UPDATER_PUBLIC_KEY="$UPDATER_PUBLIC_KEY"
    ;;
  false)
    unset AI_UPDATER_URL AI_UPDATER_PUBLIC_KEY
    ;;
  *)
    echo 'AI_UPDATER_ENABLED 只能为 true 或 false' >&2
    exit 1
    ;;
esac
export AI_UPDATER_ENABLED="$UPDATER_ENABLED"

commands=(
  "rustup target add $TARGET"
  "npm --prefix $DESKTOP_DIR ci"
  "npm --prefix $DESKTOP_DIR test"
  "npm --prefix $DESKTOP_DIR run build"
  "npm --prefix $DESKTOP_DIR run config:render"
  "npm --prefix $DESKTOP_DIR run tauri build -- --target $TARGET --config src-tauri/tauri.generated.conf.json -- --locked"
)
if [[ "$DRY_RUN" == "--dry-run" ]]; then
  printf '%s\n' "${commands[@]}"
  exit 0
fi

for command_name in node npm rustup cargo xcodebuild lipo codesign spctl; do
  command -v "$command_name" >/dev/null || {
    echo "缺少构建依赖: $command_name" >&2
    exit 1
  }
done

echo "=== 聚信 AI 助手 内网测试版构建 (arm64) ==="
echo "构建渠道: $AI_ASSISTANT_BUILD_MODE"

rustup target add "$TARGET"
npm --prefix "$DESKTOP_DIR" ci
npm --prefix "$DESKTOP_DIR" test
npm --prefix "$DESKTOP_DIR" run build
npm --prefix "$DESKTOP_DIR" run config:render
npm --prefix "$DESKTOP_DIR" run tauri build -- --target "$TARGET" --config src-tauri/tauri.generated.conf.json -- --locked

bundle="$DESKTOP_DIR/src-tauri/target/$TARGET/release/bundle"
app="$bundle/macos/聚信 AI 助手.app"
binary="$app/Contents/MacOS/juxin-ai-assistant"
[[ -f "$binary" ]] || { echo "未找到 macOS 应用二进制: $binary" >&2; exit 1; }
[[ "$(lipo -archs "$binary")" == "arm64" ]] || { echo 'macOS 产物不是纯 arm64' >&2; exit 1; }
shopt -s nullglob
dmgs=("$bundle/dmg/"*.dmg)
(( ${#dmgs[@]} > 0 )) || { echo '未找到 macOS DMG 安装包' >&2; exit 1; }
if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
  echo '代码签名校验: 通过'
else
  echo '代码签名校验: 未签名或签名无效（内部 unsigned 产物，不伪造通过状态）'
fi
if spctl --assess --type execute "$app" >/dev/null 2>&1; then
  echo 'Gatekeeper 校验: 通过'
else
  echo 'Gatekeeper 校验: 未通过（需要公司签名与公证凭据）'
fi
echo "内网测试版安装包目录: $bundle"
