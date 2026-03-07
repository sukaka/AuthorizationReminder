FROM docker.m.daocloud.io/library/node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 5184
CMD ["npm", "start"]
