# syntax = docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
FROM node:26.8-trixie-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS build
WORKDIR /app
COPY package-lock.json package.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm run build

FROM node:26.8-trixie-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS dependencies
WORKDIR /app
COPY package-lock.json package.json ./
RUN npm ci --omit=dev --ignore-scripts

# Node and required libraries only: no shell, npm, Yarn, or build tools.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:7781e8b4fccf59240bd539af6738cccf8dad4be303165c3a1fa065c48699b937 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist
USER 65532:65532
EXPOSE 3000
CMD ["dist/server.mjs"]
