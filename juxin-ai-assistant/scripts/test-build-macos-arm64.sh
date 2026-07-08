#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="$(AI_ASSISTANT_DEFAULT_SERVER_ORIGIN=https://ai.example.com \
  AI_UPDATER_ENABLED=false bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run)"
grep -q 'aarch64-apple-darwin' <<<"$output"
! grep -q 'x86_64-apple-darwin' <<<"$output"
! grep -q 'universal-apple-darwin' <<<"$output"
if AI_ASSISTANT_DEFAULT_SERVER_ORIGIN=http://ai.example.com \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'HTTP URL should fail' >&2
  exit 1
fi
if AI_ASSISTANT_DEFAULT_SERVER_ORIGIN='https://ai.example.com?redirect=http%3A%2F%2Fevil.example' \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'URL with query string should fail' >&2
  exit 1
fi
if AI_ASSISTANT_DEFAULT_SERVER_ORIGIN='https://ai.example.com#fragment' \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'URL with fragment should fail' >&2
  exit 1
fi
if AI_ASSISTANT_DEFAULT_SERVER_ORIGIN='https://ai.example.com/%2e' \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'Normalized path should fail' >&2
  exit 1
fi
updater_output="$(AI_UPDATER_ENABLED=true \
  AI_UPDATER_URL=https://updates.example.com/latest.json \
  AI_UPDATER_PUBLIC_KEY=public-key \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run)"
! grep -q 'public-key' <<<"$updater_output"
if AI_UPDATER_ENABLED=true bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'Incomplete updater configuration should fail' >&2
  exit 1
fi
