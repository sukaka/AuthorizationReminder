ARG NODE_20_ALPINE_IMAGE=node:20-alpine
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY sec-impl/backend/package*.json ./
RUN npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm_config_jobs=1 npm ci --omit=dev --no-audit --no-fund --foreground-scripts || (sleep 5; npm_config_jobs=1 npm ci --omit=dev --no-audit --no-fund --foreground-scripts)'

COPY sec-impl/backend/src ./src
COPY server/cors-origin.js ./src/cors-origin.js

EXPOSE 5185
CMD ["npm", "start"]
