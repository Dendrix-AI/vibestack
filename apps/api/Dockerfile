FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages packages
RUN npm run build --workspace @vibestack/shared && npm run build --workspace @vibestack/api

FROM node:20-alpine
RUN apk add --no-cache git docker-cli
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
