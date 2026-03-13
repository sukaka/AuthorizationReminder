ARG NODE_20_ALPINE_IMAGE=node:20-alpine
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY inventory-system/backend/package*.json ./
RUN npm ci --omit=dev

COPY inventory-system/backend/src ./src
COPY server/cors-origin.js ./src/cors-origin.js

EXPOSE 5183
CMD ["npm", "start"]
