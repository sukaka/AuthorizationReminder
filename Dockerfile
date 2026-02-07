FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

RUN npm ci
RUN npm --prefix web ci

COPY server ./server
COPY web ./web

RUN npm --prefix web run build
RUN npm prune --omit=dev

FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5179

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY package.json package-lock.json ./

EXPOSE 5179

CMD ["node", "server/index.js"]
