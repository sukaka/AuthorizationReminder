ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmmirror.com
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

COPY auth/package*.json ./auth/
COPY auth/index.js ./auth/index.js
COPY auth/admin-center-users.js ./auth/admin-center-users.js
COPY auth/admin-center-security.js ./auth/admin-center-security.js
COPY auth/admin-center-user-import.js ./auth/admin-center-user-import.js
COPY auth/audit-center-logs.js ./auth/audit-center-logs.js
COPY auth/portal-routing.js ./auth/portal-routing.js
COPY auth/csrf-security.js ./auth/csrf-security.js
COPY auth/password-security.js ./auth/password-security.js
COPY auth/session-security.js ./auth/session-security.js
COPY auth/security-bootstrap.js ./auth/security-bootstrap.js
COPY server/cors-origin.js ./server/cors-origin.js
COPY server/helmet-csp.js ./server/helmet-csp.js
COPY server/security-strict-mode.js ./server/security-strict-mode.js
COPY server/db.js ./server/db.js
COPY server/db-bootstrap.js ./server/db-bootstrap.js
COPY server/user-import.js ./server/user-import.js

WORKDIR /app/auth
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm ci --omit=dev --no-audit --no-fund --foreground-scripts || (sleep 5; npm ci --omit=dev --no-audit --no-fund --foreground-scripts)'

ENV NODE_ENV=production
ENV PORT=5180
ENV NODE_PATH=/app/auth/node_modules

EXPOSE 5180

CMD ["node", "/app/auth/index.js"]
