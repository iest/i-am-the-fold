# syntax = docker/dockerfile:1
ARG NODE_VERSION=22.17.0
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package-lock.json package.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build

FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package-lock.json package.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/server.mjs"]
