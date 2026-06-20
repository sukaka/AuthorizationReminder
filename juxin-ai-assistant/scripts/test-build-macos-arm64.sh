#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output="$(AI_ASSISTANT_PUBLIC_URL=https://ai.example.com bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run)"
grep -q 'aarch64-apple-darwin' <<<"$output"
! grep -q 'x86_64-apple-darwin' <<<"$output"
! grep -q 'universal-apple-darwin' <<<"$output"
if AI_ASSISTANT_PUBLIC_URL=http://ai.example.com bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'HTTP URL should fail' >&2
  exit 1
fi
if AI_ASSISTANT_PUBLIC_URL='https://ai.example.com?redirect=http%3A%2F%2Fevil.example' \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'URL with query string should fail' >&2
  exit 1
fi
if AI_ASSISTANT_PUBLIC_URL='https://ai.example.com#fragment' \
  bash "$SCRIPT_DIR/build-macos-arm64.sh" --dry-run; then
  echo 'URL with fragment should fail' >&2
  exit 1
fi
