# syntax=docker/dockerfile:1.7

# ---- builder ---------------------------------------------------------------
FROM node:25-bookworm-slim AS builder
WORKDIR /app
ENV LEFTHOOK=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 git \
    && rm -rf /var/lib/apt/lists/*

# Node 25 stopped bundling corepack (it's no longer preinstalled on the
# node:*-slim images) — install it explicitly before enabling it.
# - Pin to 0.34.7, not @latest: corepack@0.35.0 narrowed its own supported
#   engines range to exclude Node 25 (EBADENGINE), 0.34.x still covers it.
# - --force: npm's global bin already has yarn/yarnpkg placeholder shims on
#   this base image, and a plain install collides with them (EEXIST).
RUN npm install -g --force corepack@0.34.7 && corepack enable && corepack prepare pnpm@10 --activate

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
COPY apps/web/public ./apps/web/public
COPY packages ./packages

RUN pnpm --filter @cld/model        build || true \
 && pnpm --filter @cld/bbm          build || true \
 && pnpm --filter @cld/ydoc         build || true \
 && pnpm --filter @cld/parts-catalog build || true \
 && pnpm --filter @cld/web          build \
 && pnpm --filter @cld/server       build

# Produce a pruned prod-only node_modules with native addons already compiled.
RUN pnpm --filter @cld/server deploy --prod --legacy /app/server-deploy

# ---- runtime ---------------------------------------------------------------
FROM node:25-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV LEFTHOOK=0

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the deploy output: pruned prod node_modules with compiled native addons,
# server dist, migrations, and web dist.
COPY --from=builder /app/server-deploy/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist           ./apps/server/dist
COPY --from=builder /app/apps/server/migrations     ./apps/server/migrations
COPY --from=builder /app/apps/web/dist              ./apps/web/dist
COPY --from=builder /app/packages/model/dist        ./packages/model/dist
COPY --from=builder /app/packages/bbm/dist          ./packages/bbm/dist
COPY --from=builder /app/packages/ydoc/dist         ./packages/ydoc/dist
COPY --from=builder /app/packages/parts-catalog/dist ./packages/parts-catalog/dist

EXPOSE 3000
WORKDIR /app/apps/server
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
