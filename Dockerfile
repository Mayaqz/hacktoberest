FROM node:22-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY ui/package.json ui/
RUN npm ci
COPY erxes.json ./
COPY api api
RUN npm run build -w subedei_api

FROM base AS runtime
ENV NODE_ENV=production PORT=80
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY ui/package.json ui/
RUN npm ci --omit=dev -w subedei_api
COPY erxes.json ./
COPY --from=build /app/api/dist api/dist
# Standalone teacher console and phone simulator, served by the API.
COPY web web
ARG UI_ENTRY_URL
ENV UI_ENTRY_URL=$UI_ENTRY_URL
EXPOSE 80
CMD ["node", "api/dist/main.js"]
