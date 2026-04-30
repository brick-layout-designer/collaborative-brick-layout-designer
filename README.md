# Collaborative Brick Layout Designer

A web-based brick layout editor with Google / GitHub / OIDC sign-in, real-time
multi-user editing, organisations, layout sharing, custom parts, and saved
modules. Self-hosted via a single Docker container. Save-format compatible with
the `.bbm` + sidecar pair used by the desktop editor.

---

## ⚠️ Vibe-coded warning

> **This codebase was vibe-coded with an AI assistant.**
>
> It works, the tests pass, and the architecture is reasonable — but every
> line was generated through iterative prompting, not hand-written by a
> careful human. Treat it accordingly:
>
> - **Audit before you trust.** Especially anything touching auth, file
>   uploads, the WebSocket layer, or SQL. AI assistants are great at
>   producing plausible-looking code; security review is on you.
> - **Bugs may be subtle.** The test suite covers a lot, but AI-generated
>   code has a knack for hiding edge cases behind confident-looking comments.
> - **No production guarantees.** Self-host at your own risk. Don't expose
>   it to the open internet without a reverse proxy, TLS, rate-limiting,
>   and a backup plan.
> - **Refactor liberally.** If something looks weird, it probably is.
>   Don't preserve cruft just because the AI wrote it that way.
>
> Pull requests, issues, and "this is wrong, here's why" comments very
> welcome.

---

## What it does

- Browser-based brick layout editor
- Real-time collaboration via [Yjs](https://yjs.dev/) over WebSocket — live
  cursors, simultaneous edits, per-user undo/redo
- Multi-provider sign-in: Google, GitHub, generic OIDC, optional
  email/password
- Personal layouts + organisations; share layouts with specific users or
  whole orgs
- Layout / module ownership transfer (user → org, org → user)
- Per-resource audit log
- Custom parts: upload your own brick definitions (XML + sprite); shareable
  per-user or org-wide
- Saved modules: name a multi-brick selection as a reusable asset
- `.bbm` import / export (byte-exact round-trip with the desktop)
- Mobile read-only viewer (pan/zoom, no editing)
- Built-in backup worker with retention buckets (daily / weekly / monthly)
- Single-host Docker deploy

See [PLAN.md](./references/PLAN.md) for the full design / decisions / phase breakdown.

---

## Requirements

- **Node.js 24+** ([install](https://nodejs.org/))
- **pnpm 10+** (`npm install -g pnpm`)
- **Docker** (only for the containerised deploy)

---

## Quick start (local development)

```sh
# 1. Clone the repository.
git clone https://github.com/brick-layout-designer/collaborative-brick-layout-designer.git
cd collaborative-brick-layout-designer

# 2. Install dependencies.
pnpm install

# 3. Copy the env template and edit as needed.
cp .env.example .env
# At minimum set BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD, and
# either ENABLE_PASSWORD_AUTH=true OR fill in an OAuth provider's keys.

# 4. Run database migrations once.
pnpm --filter @cld/server exec tsx src/db/migrate.ts

# 5. Run the API server and the web dev server in parallel.
pnpm dev
```

The Vite dev server runs on **http://localhost:5173** and proxies
`/api` and `/ws` to the Fastify server on **http://localhost:3000**.
Open http://localhost:5173 in your browser.

### Run only one piece

```sh
pnpm --filter @cld/server dev   # Fastify API + WebSocket only
pnpm --filter @cld/web dev      # Vite dev server only
```

---

## Quick start (Docker)

For a single-container deploy that serves both the SPA and the API:

```sh
git clone https://github.com/brick-layout-designer/collaborative-brick-layout-designer.git
cd collaborative-brick-layout-designer
cp .env.example .env
# Edit .env — set BOOTSTRAP_ADMIN_EMAIL/PASSWORD and your OAuth keys.

docker compose up -d
```

Then open http://localhost:3000 (or whatever `HTTP_PORT` you set in `.env`).

**Front it with TLS in production.** The container does not bundle a
reverse proxy on purpose — point Caddy / Traefik / Cloudflare Tunnel /
nginx at port 3000 and let it handle TLS.

### Volumes

| Volume         | Mounted at  | Purpose                              |
|----------------|-------------|--------------------------------------|
| `cbld-data`    | `/data`     | SQLite database file                 |
| `cbld-backups` | `/backups`  | Daily gzipped DB snapshots           |

---

## Configuration

All settings come from environment variables. See `.env.example` for the
full list. Notable ones:

| Variable                  | Default                 | Notes                                              |
|---------------------------|-------------------------|----------------------------------------------------|
| `HTTP_PORT`               | `3000`                  | Port the server listens on                         |
| `PUBLIC_URL`              | `http://localhost:3000` | Used for OAuth callback URLs                       |
| `DB_PATH`                 | `./data/cbld.sqlite`    | SQLite file path                                   |
| `COOKIE_SECURE`           | `false`                 | Set `true` behind TLS                              |
| `ENABLE_PASSWORD_AUTH`    | `false`                 | Enable email/password registration                 |
| `DEMO_MODE`               | `false`                 | New accounts become demo accounts                  |
| `DEMO_LAYOUT_TTL_DAYS`    | `30`                    | Auto-expire demo-owned layouts after N days        |
| `BOOTSTRAP_ADMIN_EMAIL`   | —                       | Created on first start if absent                   |
| `BOOTSTRAP_ADMIN_PASSWORD`| —                       | Pair with the above; min 12 chars                  |
| `GOOGLE_CLIENT_ID/SECRET` | —                       | Enables Google OAuth when both set                 |
| `GITHUB_CLIENT_ID/SECRET` | —                       | Enables GitHub OAuth when both set                 |
| `OIDC_ISSUER_URL/...`     | —                       | Generic OIDC (Microsoft, Auth0, Keycloak, …)       |
| `SMTP_HOST/PORT/...`      | —                       | If set, invites are emailed; else copy-paste links |
| `BACKUPS_ENABLED`         | `true`                  | Daily backup worker                                |
| `BACKUPS_DIR`             | `/backups`              | Where backups land                                 |
| `DEMO_TTL_SWEEP_ENABLED`  | `true`                  | Daily sweep of expired demo layouts                |
| `DAILY_COMPACTION_ENABLED`| `true`                  | Daily Yjs compaction worker                        |

### OAuth setup (one-time)

Each provider needs an authorised callback URL of the shape:

```
<PUBLIC_URL>/api/auth/<provider>/callback
```

For local development that's `http://localhost:3000/api/auth/google/callback`
(and the GitHub / OIDC equivalents). Paste the resulting client ID + secret
into `.env`.

---

## Common tasks

```sh
# Run the full test suite
pnpm test

# Type-check everything
pnpm typecheck

# Build everything (web SPA + server bundle + libs)
pnpm build

# Generate a new Drizzle migration after editing schema.ts
pnpm --filter @cld/server exec drizzle-kit generate

# Apply pending migrations
pnpm --filter @cld/server exec tsx src/db/migrate.ts

# Secret scan + dependency scan (CI mirrors these)
pnpm scan:secrets
pnpm scan:deps
```

---

## Repository layout

```
apps/
  server/           Fastify API + WebSocket + workers
    src/
      routes/       HTTP route modules
      ws/           y-websocket handler
      workers/      Backup, compaction, demo-TTL workers
      db/           Drizzle schema + migrations
  web/              React + Vite SPA
    src/
      editor/       Konva canvas + Yjs editor
      layouts/      Layout list, share dialog, audit panel
      orgs/         Organisation pages
packages/
  bbm/              `.bbm` reader/writer (byte-exact round-trip)
  model/            Pure domain model (bricks, layers, layout)
  parts-catalog/    Parts XML scanner
  ydoc/             Yjs ↔ model projection
.github/workflows/  CI (PR build), nightly, release
```

---

## CI / Releases

GitHub Actions workflows:

- **`ci.yml`** — runs on every PR: lint, typecheck, build, test,
  dependency review, OSV scan, secret scan, Trivy.
- **`nightly.yml`** — pushes a `:nightly` multi-arch image to GHCR and
  attaches a Trivy report.
- **`release.yml`** — fires on `v*` tags: builds + publishes
  `:vX.Y.Z` and `:latest`, gates the release on Trivy CRITICAL CVEs,
  generates Conventional-Commits-grouped release notes.

Cut a release:

```sh
git tag -a v1.2.0 -m "v1.2.0 — release notes"
git push origin v1.2.0
```

---

## Contributing

- Conventional Commits enforced by lefthook + CI (`feat:`, `fix:`,
  `docs:`, `chore:`, etc.)
- Pre-commit hooks run typecheck + secret scan; pre-push runs the full
  test suite. Don't bypass with `--no-verify`.
- New features need tests. The bar for AI-generated additions is
  *higher* than for human-written code, not lower — bring fixtures.

---

## Licence

[AGPL-3.0-or-later](./LICENSE).
