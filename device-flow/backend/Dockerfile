ARG NODE_20_ALPINE_IMAGE=node:20-alpine
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY device-flow/backend/package*.json ./
RUN npm ci --omit=dev

COPY device-flow/backend/src ./src
COPY server/cors-origin.js ./src/cors-origin.js

EXPOSE 5184
CMD ["npm", "start"]
