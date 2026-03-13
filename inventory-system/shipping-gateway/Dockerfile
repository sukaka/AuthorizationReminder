ARG NODE_20_ALPINE_IMAGE=node:20-alpine
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY inventory-system/shipping-gateway/package*.json ./
RUN npm ci --omit=dev

COPY inventory-system/shipping-gateway/src ./src
COPY server/cors-origin.js ./src/cors-origin.js

EXPOSE 5190
CMD ["npm", "start"]
