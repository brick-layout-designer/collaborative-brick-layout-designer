# syntax=docker/dockerfile:1.7

# ---- builder ---------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV LEFTHOOK=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/tsconfig.json apps/server/tsconfig.build.json apps/server/drizzle.config.ts ./apps/server/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/tailwind.config.js apps/web/postcss.config.js apps/web/index.html ./apps/web/
COPY packages/model/package.json packages/model/tsconfig.json ./packages/model/
COPY packages/bbm/package.json packages/bbm/tsconfig.json ./packages/bbm/
COPY packages/ydoc/package.json packages/ydoc/tsconfig.json ./packages/ydoc/
COPY packages/parts-catalog/package.json packages/parts-catalog/tsconfig.json ./packages/parts-catalog/

RUN git init && pnpm install --frozen-lockfile=false

COPY apps/server/src ./apps/server/src
COPY apps/server/migrations ./apps/server/migrations
COPY apps/web/src ./apps/web/src
COPY packages ./packages

RUN pnpm --filter @cld/model        build || true \
 && pnpm --filter @cld/bbm          build || true \
 && pnpm --filter @cld/ydoc         build || true \
 && pnpm --filter @cld/parts-catalog build || true \
 && pnpm --filter @cld/web          build \
 && pnpm --filter @cld/server       build

# ---- runtime ---------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV LEFTHOOK=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY --from=builder /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/web/package.json   ./apps/web/
COPY --from=builder /app/packages/model/package.json        ./packages/model/
COPY --from=builder /app/packages/bbm/package.json          ./packages/bbm/
COPY --from=builder /app/packages/ydoc/package.json         ./packages/ydoc/
COPY --from=builder /app/packages/parts-catalog/package.json ./packages/parts-catalog/

RUN pnpm install --prod --frozen-lockfile=false --ignore-scripts \
 && corepack disable \
 && npm uninstall -g corepack \
 && rm -rf /root/.local/share/pnpm /root/.cache/node/corepack

# Copy the pre-compiled native addon from the builder so we don't need
# build tools (python, gcc) in the runtime image.
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@12.4.1/node_modules/better-sqlite3/build \
                    /app/node_modules/.pnpm/better-sqlite3@12.4.1/node_modules/better-sqlite3/build

COPY --from=builder /app/apps/server/dist        ./apps/server/dist
COPY --from=builder /app/apps/server/migrations  ./apps/server/migrations
COPY --from=builder /app/apps/web/dist           ./apps/web/dist
COPY --from=builder /app/packages/model/dist        ./packages/model/dist
COPY --from=builder /app/packages/bbm/dist          ./packages/bbm/dist
COPY --from=builder /app/packages/ydoc/dist         ./packages/ydoc/dist
COPY --from=builder /app/packages/parts-catalog/dist ./packages/parts-catalog/dist

EXPOSE 3000
WORKDIR /app/apps/server
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
