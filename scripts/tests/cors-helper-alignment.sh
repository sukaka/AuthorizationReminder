#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

target_sources=(
  "train-exam/backend/src/index.js"
  "inventory-system/backend/src/index.js"
  "device-flow/backend/src/index.js"
  "sec-impl/backend/src/index.js"
  "faq/backend/src/index.js"
  "tender/backend/src/index.js"
  "ticketing/index.js"
  "inventory-system/shipping-gateway/src/index.js"
)

for file in "${target_sources[@]}"; do
  grep -q "isOriginAllowedForRequest" "$file"
  grep -q "const corsOptions = (req, cb) =>" "$file"
done

target_dockerfiles=(
  "ticketing/Dockerfile"
  "train-exam/backend/Dockerfile"
  "inventory-system/backend/Dockerfile"
  "device-flow/backend/Dockerfile"
  "sec-impl/backend/Dockerfile"
  "faq/backend/Dockerfile"
  "tender/backend/Dockerfile"
  "inventory-system/shipping-gateway/Dockerfile"
)

for file in "${target_dockerfiles[@]}"; do
  grep -q "cors-origin.js" "$file"
done

grep -q "dockerfile: inventory-system/shipping-gateway/Dockerfile" docker-compose.yml
grep -q "dockerfile: inventory-system/backend/Dockerfile" docker-compose.yml
grep -q "dockerfile: device-flow/backend/Dockerfile" docker-compose.yml
grep -q "dockerfile: sec-impl/backend/Dockerfile" docker-compose.yml
grep -q "dockerfile: faq/backend/Dockerfile" docker-compose.yml
grep -q "dockerfile: tender/backend/Dockerfile" docker-compose.yml
grep -q "dockerfile: train-exam/backend/Dockerfile" docker-compose.yml

echo "cors helper alignment ok"
