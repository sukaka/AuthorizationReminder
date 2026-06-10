ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${NODE_20_BOOKWORM_SLIM_IMAGE} AS build
ARG NPM_REGISTRY
WORKDIR /app

COPY package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && npm ci --no-audit --no-fund

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}
ARG NPM_REGISTRY
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5192

COPY package*.json ./
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

USER node
EXPOSE 5192
CMD ["node", "dist/server.js"]
