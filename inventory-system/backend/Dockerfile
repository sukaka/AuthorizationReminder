ARG NODE_20_ALPINE_IMAGE=node:20-alpine
FROM ${NODE_20_ALPINE_IMAGE}

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 5183
CMD ["npm", "start"]
