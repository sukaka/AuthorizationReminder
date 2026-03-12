ARG NODE_20_BOOKWORM_IMAGE=node:20-bookworm
ARG NGINX_1_25_ALPINE_IMAGE=nginx:1.25-alpine
FROM ${NODE_20_BOOKWORM_IMAGE} AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . ./
RUN npm run build

FROM ${NGINX_1_25_ALPINE_IMAGE}

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
