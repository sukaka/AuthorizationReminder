ARG NODE_20_BOOKWORM_IMAGE=node:20-bookworm
ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
ARG NPM_REGISTRY=https://registry.npmmirror.com
FROM ${NODE_20_BOOKWORM_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm ci --no-audit --no-fund --foreground-scripts || (sleep 5; npm ci --no-audit --no-fund --foreground-scripts)'
RUN sh -ec 'npm --prefix web ci --no-audit --no-fund --foreground-scripts || (sleep 5; npm --prefix web ci --no-audit --no-fund --foreground-scripts)'

COPY server ./server
COPY web ./web

RUN npm --prefix web run build
RUN npm prune --omit=dev

FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5179

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY package.json package-lock.json ./

EXPOSE 5179

CMD ["node", "server/index.js"]
