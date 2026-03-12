ARG NODE_20_ALPINE_IMAGE=node:20-alpine
ARG NGINX_ALPINE_IMAGE=nginx:alpine
FROM ${NODE_20_ALPINE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm config set fetch-retries 6 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set fetch-timeout 300000 \
 && sh -ec 'npm ci --no-audit --no-fund --foreground-scripts || (sleep 5; npm ci --no-audit --no-fund --foreground-scripts)'
COPY . .
RUN npm run build

FROM ${NGINX_ALPINE_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
