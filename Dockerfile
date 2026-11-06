FROM node:26-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim
LABEL org.opencontainers.image.source="https://github.com/jameson13b/poly-paradise" \
      org.opencontainers.image.description="Poly Paradise: party games across everyone's own devices"
WORKDIR /app
ENV NODE_ENV=production PORT=80 DB_PATH=/storage/poly.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY server server
COPY shared shared
COPY --from=build /app/dist dist
VOLUME /storage
EXPOSE 80
CMD ["node", "server/index.ts"]
