ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 5188
CMD ["npm", "start"]
