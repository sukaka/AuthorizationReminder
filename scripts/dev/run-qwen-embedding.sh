#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
model_path="$repo_root/Qwen3-Embedding-4B-GGUF/Qwen3-Embedding-4B-Q4_K_M.gguf"

if [ ! -s "$model_path" ]; then
  echo "Qwen embedding model is missing: $model_path" >&2
  exit 1
fi

exec /opt/homebrew/bin/llama-server \
  -m "$model_path" \
  --host 0.0.0.0 \
  --port 8091 \
  --embedding \
  --pooling last \
  --ctx-size 2048 \
  --batch-size 256 \
  --ubatch-size 256 \
  --parallel 1
