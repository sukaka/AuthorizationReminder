ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmmirror.com
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

COPY ticketing/package.json ./ticketing/package.json
COPY ticketing/index.js ./ticketing/index.js
COPY server/cors-origin.js ./server/cors-origin.js
COPY server/db.js ./server/db.js
COPY server/db-bootstrap.js ./server/db-bootstrap.js

WORKDIR /app/ticketing
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm install --omit=dev --no-audit --no-fund --foreground-scripts || (sleep 5; npm install --omit=dev --no-audit --no-fund --foreground-scripts)'

ENV NODE_ENV=production
ENV PORT=5182
ENV NODE_PATH=/app/ticketing/node_modules

EXPOSE 5182

CMD ["node", "/app/ticketing/index.js"]
