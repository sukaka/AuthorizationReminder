ARG NODE_20_BOOKWORM_SLIM_IMAGE=node:20-bookworm-slim
FROM ${NODE_20_BOOKWORM_SLIM_IMAGE}

ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app

COPY prompt-center/backend/package*.json ./
RUN npm config set registry ${NPM_REGISTRY} && npm ci --omit=dev

COPY prompt-center/backend/src ./src
COPY prompt-center/backend/scripts ./scripts
COPY juxin-ai-assistant/server/catalog/assistants.json ./catalog/ai-assistant-assistants.json

ENV NODE_ENV=production
EXPOSE 5189
CMD ["node", "src/index.js"]
