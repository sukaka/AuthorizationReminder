ARG NODE_20_ALPINE_IMAGE=node:20-alpine
ARG NGINX_ALPINE_IMAGE=nginx:alpine

FROM ${NODE_20_ALPINE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
COPY package*.json ./
RUN npm config set registry ${NPM_REGISTRY} && npm ci
COPY . .
RUN npm run build

FROM ${NGINX_ALPINE_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
