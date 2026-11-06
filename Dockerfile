FROM node:26-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production PORT=80 DB_PATH=/data/poly.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY server server
COPY shared shared
COPY --from=build /app/dist dist
VOLUME /data
EXPOSE 80
CMD ["node", "server/index.ts"]
