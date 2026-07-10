ARG NODE_20_ALPINE_IMAGE=node:20-alpine
ARG NGINX_ALPINE_IMAGE=nginx:alpine

FROM ${NODE_20_ALPINE_IMAGE} AS build
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG VITE_AUTH_PUBLIC_URL
ARG VITE_ADMIN_CENTER_URL
ARG VITE_PROMPT_CENTER_URL
ENV VITE_AUTH_PUBLIC_URL=$VITE_AUTH_PUBLIC_URL
ENV VITE_ADMIN_CENTER_URL=$VITE_ADMIN_CENTER_URL
ENV VITE_PROMPT_CENTER_URL=$VITE_PROMPT_CENTER_URL
WORKDIR /app
COPY package*.json ./
RUN npm config set registry ${NPM_REGISTRY} && npm ci
COPY . .
RUN npm run build:web

FROM ${NGINX_ALPINE_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
