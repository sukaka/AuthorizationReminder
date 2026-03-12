FROM docker.m.daocloud.io/library/node:20-bookworm-slim

WORKDIR /app

COPY ticketing/package.json ./ticketing/package.json
COPY ticketing/index.js ./ticketing/index.js
COPY server/db.js ./server/db.js
COPY server/db-bootstrap.js ./server/db-bootstrap.js

WORKDIR /app/ticketing
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=5182
ENV NODE_PATH=/app/ticketing/node_modules

EXPOSE 5182

CMD ["node", "/app/ticketing/index.js"]
