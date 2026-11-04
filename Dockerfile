# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN npm install -g pnpm@11.7.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json app.ts ./
COPY lib ./lib
COPY listeners ./listeners
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data \
    NODE_OPTIONS=--max-old-space-size=128
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json LICENSE NOTICE ./
COPY assets ./assets
USER 10001
EXPOSE 8080
CMD ["node", "dist/app.js"]
