ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

COPY auth/package*.json ./auth/
COPY auth/index.js ./auth/index.js
COPY auth/csrf-security.js ./auth/csrf-security.js
COPY auth/password-security.js ./auth/password-security.js
COPY auth/session-security.js ./auth/session-security.js
COPY auth/security-bootstrap.js ./auth/security-bootstrap.js
COPY server/cors-origin.js ./server/cors-origin.js
COPY server/db.js ./server/db.js
COPY server/db-bootstrap.js ./server/db-bootstrap.js

WORKDIR /app/auth
RUN npm ci --omit=dev

ENV NODE_ENV=production
ENV PORT=5180
ENV NODE_PATH=/app/auth/node_modules

EXPOSE 5180

CMD ["node", "/app/auth/index.js"]
