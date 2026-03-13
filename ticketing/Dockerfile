ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

COPY ticketing/package.json ./ticketing/package.json
COPY ticketing/index.js ./ticketing/index.js
COPY server/cors-origin.js ./server/cors-origin.js
COPY server/db.js ./server/db.js
COPY server/db-bootstrap.js ./server/db-bootstrap.js

WORKDIR /app/ticketing
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=5182
ENV NODE_PATH=/app/ticketing/node_modules

EXPOSE 5182

CMD ["node", "/app/ticketing/index.js"]
