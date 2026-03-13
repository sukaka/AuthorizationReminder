ARG NODE_20_ALPINE_IMAGE=node:20-alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY device-flow/backend/package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm ci --omit=dev --no-audit --no-fund --foreground-scripts || (sleep 5; npm ci --omit=dev --no-audit --no-fund --foreground-scripts)'

COPY device-flow/backend/src ./src
COPY server/cors-origin.js ./src/cors-origin.js

EXPOSE 5184
CMD ["npm", "start"]
