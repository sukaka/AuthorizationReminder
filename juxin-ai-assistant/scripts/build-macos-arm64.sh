#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$ROOT_DIR/apps/desktop"
TARGET="aarch64-apple-darwin"
WORKBENCH_URL="${AI_ASSISTANT_PUBLIC_URL:-}"
DRY_RUN="${1:-}"

if [[ ! -t 0 && -z "${CI:-}" ]]; then
  export CI=true
fi

[[ "$WORKBENCH_URL" =~ ^https://[^/:]+(:[0-9]+)?$ ]] || {
  echo 'AI_ASSISTANT_PUBLIC_URL 必须是无路径、无凭据的 HTTPS origin' >&2
  exit 1
}
[[ "$WORKBENCH_URL" != *"*"*
  && "$WORKBENCH_URL" != *"@"*
  && "$WORKBENCH_URL" != *"?"*
  && "$WORKBENCH_URL" != *"#"* ]] || {
  echo 'AI_ASSISTANT_PUBLIC_URL 不得包含 wildcard、凭据、查询串或片段' >&2
  exit 1
}

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

export AI_ASSISTANT_PUBLIC_URL="$WORKBENCH_URL"
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
echo "安装包目录: $bundle"
