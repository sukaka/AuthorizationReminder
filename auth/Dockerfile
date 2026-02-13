FROM node:20-bookworm-slim

WORKDIR /app

COPY auth/package.json ./auth/package.json
COPY auth/index.js ./auth/index.js
COPY server/db.js ./server/db.js

WORKDIR /app/auth
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=5180
ENV NODE_PATH=/app/auth/node_modules

EXPOSE 5180

CMD ["node", "/app/auth/index.js"]
