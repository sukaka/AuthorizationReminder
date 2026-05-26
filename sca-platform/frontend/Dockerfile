ARG NODE_20_ALPINE_IMAGE=node:20-alpine
ARG NGINX_ALPINE_IMAGE=nginx:alpine

FROM ${NODE_20_ALPINE_IMAGE} AS build
WORKDIR /app

ARG VITE_API_BASE=
ARG VITE_SSO_LOGIN_URL=http://localhost:5180/login?system=sca
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_SSO_LOGIN_URL=${VITE_SSO_LOGIN_URL}

COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM ${NGINX_ALPINE_IMAGE}
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
