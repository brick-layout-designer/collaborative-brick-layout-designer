# CLD Web — Collaborative BlueBrick Layout Designer

A web port of Collaborative Layout Designer with Google sign-in, real-time
multi-user editing, organizations, and layout sharing. Self-hosted via
`docker compose up`. Save-format compatible with the desktop CLD's `.bbm`
+ sidecar pair.

## 1. Goals & non-goals

### Goals
- Browser-based map editor — same brick-on-grid model as desktop CLD
- Multi-provider auth: Google OAuth (primary), GitHub OAuth, Microsoft / generic
  OIDC, plus optional email/password (gated, for demos / bootstrap)
- Per-user save library + share-by-invite to specific users
- Organizations: users belong to N orgs; layouts can be owned by an org
- Layout ownership transfer (user → org, org → org, org → user) for owners
- Real-time collaboration: live cursors, simultaneous edits, presence
- Per-user undo/redo (not shared across collaborators)
- Per-layout audit log: every persisted action recorded with user attribution
- `.bbm` + sidecar import/export — same on-disk format as desktop
- **Custom parts**: users can upload their own brick definitions (XML + sprite);
  ownable by user or org; sharing tiers mirror layouts (private / specific
  users / org-wide). Public-to-instance is v2.
- **Saved module library**: users can save a multi-brick selection as a
  named, reusable module; ownable by user or org; same sharing tiers as
  layouts. Mirrors desktop CLD's `Module` concept but elevates it from
  "embedded in one layout" to "first-class shareable asset".
- Read-only viewer that works on phones (pan/zoom, no editing)
- Built-in backup worker with retention (daily / weekly / monthly buckets)
- Single-host Docker deploy (one `docker compose up`)
- GitHub CI: per-PR build/lint, nightly builds on main, tagged releases on `v*`

### Non-goals (initial)
- Multi-instance horizontal scaling (Redis pub/sub, k8s) — deferred
- Voice/video chat
- Touch-first editing on phones/tablets (read-only viewer only on small screens;
  editing is desktop-canvas first)
- WASM port of the C++ rasterizer (use Konva for rendering instead)
- Desktop CLD parity for every dialog (start with the editing primitives)
- Instance-wide public parts/modules library — defer to v2 (moderation,
  versioning, attribution all need design first)

## 2. Tech stack

### Frontend
- **React + TypeScript** (Vite for dev/build)
- **Konva** for canvas rendering (best perf for many shapes; supports custom drawing)
- **Yjs** for collaborative state (CRDT — no manual conflict resolution)
- **y-websocket** client → custom server (we own the WS server)
- **Zustand** for non-collab UI state (current tool, panel visibility, etc.)
- **TanStack Query** for REST data fetching/caching
- **Tailwind** for styling

### Backend
- **Node.js + Fastify** (TypeScript)
- **SQLite** (via `better-sqlite3`) in WAL mode for primary data store.
  One file on a docker volume; no separate db container. Yjs binary blobs
  live in BLOB columns. Concurrent readers + serialised writers is fine for
  single-host scale.
- **Drizzle ORM** (lightweight, SQL-first, plays nice with TS) — same Drizzle
  schema with the SQLite driver. Code MUST avoid Postgres-only features
  (`jsonb` operators, row-level locks, `bytea` syntax, sequence types) so
  a future migration to Postgres is a driver swap, not a rewrite.
- **y-websocket** server (in-process with Fastify on single-host deploy)
- **Arctic** (OAuth flows) + **openid-client** (generic OIDC) + a thin
  hand-rolled `sessions` table — the same author's actively-maintained
  successor to Lucia v3, which was deprecated in 2024. Covers Google, GitHub,
  Microsoft / generic OIDC, plus password (argon2 via `@node-rs/argon2`).
- **Nodemailer** with SMTP (env-configured) for invite emails when SMTP is
  available; otherwise the app falls back to copy-paste links
- **Sharp** for any server-side image work (.bbm GIFs, sprite generation if needed)

### Infrastructure
- Single-container `docker-compose.yml`: just `web` (Fastify serves the SPA,
  the API, the WebSocket, and `/parts/*` from disk; SQLite file on a docker
  volume). No bundled nginx — operators put their own reverse proxy in front
  for TLS (Caddy / Traefik / Cloudflare Tunnel / nginx / whatever they
  already run).
- Docker volumes for SQLite data and backup output; bind-mount of the
  `parts-library/` submodule into the container at `/parts` (read-only).
- Env-driven config; no secrets in compose file.

### Parts library
- **BlueBrickParts** (727 XMLs + 670 GIFs, ~26 MB) is added as a **git submodule**
  pointing at the same upstream the desktop uses. Guarantees part IDs match
  desktop 1:1 and the library is version-pinned with the rest of the source.
- Bind-mounted read-only into the web container; Fastify serves it at
  `/parts/*` with long cache-control headers (`@fastify/static`).

### Pinned versions (locked at planning time)
Pin in `package.json` so the day-1 spike doesn't pick up breaking changes:
React 18, Vite 5, TypeScript 5.5, Yjs 13, y-websocket 2, Konva 9, Zustand 4,
TanStack Query 5, Tailwind 3, Fastify 4, Drizzle 0.33+, Arctic 2, openid-client 5,
@node-rs/argon2 1.8, Nodemailer 6, Sharp 0.33. (Adjust to current latest at
scaffold time, but pin exact.)

### Why these choices
- **Konva over native Canvas/Pixi**: hit testing + transform handles + grouping
  are built in, which the editor needs everywhere. Pixi is faster for thousands
  of animated sprites; we have thousands of static sprites — Konva wins on
  developer velocity.
- **Yjs over OT (Operational Transform)**: CRDTs survive offline edits and
  network partitions; OT requires a centralised authority for ordering. With
  Yjs the server is dumb relay + persistence, which keeps the websocket layer
  simple.
- **Arctic + thin session layer over Auth.js / Passport**: Lucia v3 was the
  natural fit (session-based, cookie-only, Google OAuth + password out of the
  box) but was deprecated by its author in 2024. The author's successor path
  is **Arctic** (OAuth provider clients) + a hand-rolled `sessions` table —
  ~50 lines of glue code that's easy to read end-to-end and avoids JWT-in-
  localStorage. Auth.js is a heavier framework optimised for Next.js.
- **Drizzle over Prisma**: Prisma's migration story is great but its query
  builder shape is opinionated; Drizzle stays close to SQL, which makes the
  sharing-access queries easier to reason about, and it has first-class
  SQLite support so the future Postgres migration is a driver swap.
- **SQLite over Postgres** (for v1): single-host is the deploy goal, SQLite
  in WAL mode handles the read/write profile (small bursty edits, big
  occasional Yjs blobs), and the operational story is one file. Drizzle
  schema stays portable so the swap is realistic if/when multi-instance
  becomes a goal.

## 3. Data model

### 3.1 Authoritative entities (SQLite — types kept portable to Postgres)

Type conventions used below to keep the schema portable to Postgres later
without renaming columns or rewriting queries:
- `uuid` → SQLite stores as `text` (16-byte hex); Drizzle handles encoding.
- `bytea` → SQLite `blob`. Drizzle `blob` works on both engines.
- `timestamptz` → SQLite `integer` (unix-millis); Drizzle `timestamp` mode.
- `jsonb` → SQLite `text` with JSON inside; queries restrict themselves to
  whole-blob reads (no jsonb path operators), so Postgres can later pick
  the same column up as `jsonb` without a query rewrite.
- `bigserial` → integer primary key (autoincrement on both engines).

```
users
  id              uuid pk
  email           text unique not null
  display_name    text not null
  avatar_url      text
  password_hash   text                    -- null for OAuth-only accounts
  is_demo_account boolean default false   -- see §3.4 demo-account restrictions
  created_at      timestamptz default now()

-- one row per linked OAuth provider; lets a single user link multiple providers.
oauth_accounts
  provider          text                  -- 'google' | 'github' | 'microsoft' | 'oidc'
  provider_user_id  text
  user_id           uuid fk(users)
  primary key (provider, provider_user_id)

orgs
  id              uuid pk
  name            text not null
  slug            text unique not null    -- /orgs/<slug>
  created_at      timestamptz default now()

org_members
  org_id          uuid fk(orgs)
  user_id         uuid fk(users)
  role            text check in ('admin', 'member') not null
  joined_at       timestamptz default now()
  primary key (org_id, user_id)

org_invites
  id              uuid pk
  org_id          uuid fk(orgs)
  invited_email   text not null
  invited_by      uuid fk(users)
  role            text not null
  token           text unique not null
  expires_at      timestamptz not null
  accepted_at     timestamptz             -- null = pending

layouts
  id              uuid pk
  title           text not null
  owner_user_id   uuid fk(users)          -- exactly one of owner_user_id / owner_org_id is set
  owner_org_id    uuid fk(orgs)
  created_by      uuid fk(users) not null
  created_at      timestamptz default now()
  updated_at      timestamptz default now()
  -- For demo-owned layouts: timestamp at which a sweeper deletes the row.
  -- Null for non-demo-owned layouts. Set on insert when the owner is a demo
  -- account, cleared on transfer to a non-demo owner.
  expires_at      timestamptz
  -- Snapshot of the Yjs doc, materialised periodically and on close.
  -- Stored as the binary y-update format (NOT bbm). bbm is import/export only.
  doc_snapshot    bytea not null
  doc_version     bigint not null default 0  -- monotonic; bumps on every persisted snapshot
  -- Sidecar lives in the same row as a separate Yjs sub-doc payload so
  -- they version together and a layout is always a single row.
  -- Note: sidecar's on-disk format is JSON (not XML); the Yjs representation
  -- is binary y-update — the JSON shape is reconstructed at export time.
  sidecar_snapshot bytea
  check ((owner_user_id is null) <> (owner_org_id is null))

layout_collaborators
  layout_id       uuid fk(layouts)
  user_id         uuid fk(users)
  role            text check in ('viewer', 'editor', 'owner') not null
  added_at        timestamptz default now()
  primary key (layout_id, user_id)

layout_invites
  id              uuid pk
  layout_id       uuid fk(layouts)
  invited_email   text not null
  role            text not null
  token           text unique not null
  expires_at      timestamptz not null
  accepted_at     timestamptz

-- Persistent y-update log between snapshots. On every WS update we append
-- the binary update; periodically we compact into a fresh snapshot and
-- truncate. Lets a client recover the latest state without losing the
-- last few seconds of edits if the server restarts.
layout_updates
  id              bigserial pk
  layout_id       uuid fk(layouts)
  doc             text check in ('main', 'sidecar') not null
  update_bytes    bytea not null
  created_at      timestamptz default now()

sessions
  id              text pk
  user_id         uuid fk(users)
  expires_at      timestamptz not null

-- Per-layout audit log. Append-only. Written by the snapshot worker as part
-- of compaction so each row corresponds to one logical persisted change.
audit_events
  id              bigserial pk
  layout_id       uuid fk(layouts) not null
  user_id         uuid fk(users)              -- null for system events (TTL sweep, transfer admin)
  event_type      text not null               -- 'open' | 'close' | 'edit' | 'share' | 'unshare'
                                              -- | 'role_change' | 'transfer' | 'import' | 'export' | 'rename'
  payload         jsonb not null              -- type-specific details (target user, old/new role, etc.)
  doc_version     bigint                      -- snapshot version at time of event, when applicable
  created_at      timestamptz default now()
  index on (layout_id, created_at desc)

-- User- or org-uploaded part definition. Same shape as a BlueBrickParts
-- entry: an XML metadata blob + a sprite GIF (or PNG). The bundled
-- BlueBrickParts library is NOT modelled here — it's static, served from
-- /parts/* by Fastify. Only custom parts hit the database.
custom_parts
  id              uuid pk
  part_number     text not null               -- the user's chosen identifier; must be unique per owner
  display_name    text not null
  owner_user_id   uuid fk(users)
  owner_org_id    uuid fk(orgs)
  created_by      uuid fk(users) not null
  xml_blob        bytea not null              -- full part XML (mirrors a BlueBrickParts XML file)
  sprite_blob     bytea not null              -- GIF or PNG sprite
  sprite_mime     text not null               -- 'image/gif' | 'image/png'
  created_at      timestamptz default now()
  updated_at      timestamptz default now()
  check ((owner_user_id is null) <> (owner_org_id is null))
  unique (owner_user_id, part_number)         -- ditto for org owners
  unique (owner_org_id,  part_number)

custom_part_collaborators
  custom_part_id  uuid fk(custom_parts)
  user_id         uuid fk(users)
  role            text check in ('viewer', 'editor', 'owner') not null
  added_at        timestamptz default now()
  primary key (custom_part_id, user_id)

-- Reusable named module: a saved selection of bricks (and their
-- relative positions / per-brick metadata) that can be dropped into any
-- layout the user/org has access to. Mirrors desktop's `Module` but
-- promotes it to a first-class, shareable asset.
modules
  id              uuid pk
  title           text not null
  owner_user_id   uuid fk(users)
  owner_org_id    uuid fk(orgs)
  created_by      uuid fk(users) not null
  -- Same Yjs / on-disk story as layouts: snapshot + update log + sidecar.
  -- Module sidecar is a subset of layout sidecar (no venue, no rulers).
  doc_snapshot    bytea not null
  doc_version     bigint not null default 0
  sidecar_snapshot bytea
  created_at      timestamptz default now()
  updated_at      timestamptz default now()
  check ((owner_user_id is null) <> (owner_org_id is null))

module_collaborators
  module_id       uuid fk(modules)
  user_id         uuid fk(users)
  role            text check in ('viewer', 'editor', 'owner') not null
  added_at        timestamptz default now()
  primary key (module_id, user_id)
```

**Design notes:**
- Layout ownership is exclusive: a layout has one owner (user OR org), not both.
- `layout_collaborators` is the share list. A user with org membership doesn't
  automatically appear here — they get access via the org-ownership join.
  See §3.3 access rules.
- We persist Yjs binary updates, not parsed JSON, because that's what the
  client sends and the server is "dumb" about doc internals. Compaction is a
  background job: every N updates, replay them into a snapshot, write the
  snapshot, delete the consumed updates. Crash-safe because the snapshot has
  to commit before deletes.
- `.bbm` does **not** appear in the schema. It's a serialisation boundary —
  importer reads `.bbm` → constructs a fresh Yjs doc → server stores binary
  Yjs. Exporter reads Yjs → constructs `.bbm`. Round-trip parity is enforced
  by the same property tests we'd use on desktop.

### 3.2 Yjs document shape

Each layout has one Yjs document (`Y.Doc`) with these top-level types:

```
doc.getMap('meta')               -- title, author, grid size, units (mirrors .bbm header)
doc.getArray('layers')           -- ordered list of LayerRef
doc.getMap('layerData')          -- LayerRef.id → layer-specific Y.Map
doc.getMap('venue')              -- single-venue model (walls, doors, obstacles)
doc.getMap('modules')            -- moduleId → module def
doc.getMap('labels')             -- standalone text labels
```

Sidecar is a *separate* `Y.Doc` (own update stream, own snapshot column) so
the two can be versioned independently — same separation as on disk.

```
sidecar.getMap('meta')
sidecar.getMap('connections')    -- per-brick connectivity overrides
sidecar.getArray('rulers')
sidecar.getArray('areas')
... etc
```

**Derived fields excluded from Yjs**, computed client-side on every update:
- `Brick.linkedToId` — recomputed by the client's connectivity pass on doc
  change. Storing it in Yjs would let two users mutate the same brick's
  connectivity in conflicting ways. **Port the desktop's existing O(N)
  spatial-bucketing algorithm** from `src/edit/` (2-stud grid buckets, ±1
  bucket neighbourhood, 1-stud tolerance) — do not re-implement.
- Hull cache, sprite cache — local-only.
- Selection state — local-only (we use Yjs *awareness* for "what is user X
  highlighting", not the doc itself).

### 3.3 Access rules (resolved server-side on every API/WS call)

A user has access to a layout iff any of:

1. They are the layout's owner (`layouts.owner_user_id = user.id`)
2. The layout is owned by an org and they're a member of that org
3. They appear in `layout_collaborators` for that layout

Their **role** for the layout is the strongest of:

- `owner` — owner_user_id match, or org-admin on the owning org
- `editor` — org-member on the owning org (default), or explicit editor share
- `viewer` — explicit viewer share

Implemented as a single generic TypeScript helper
`resolveResourceRole(userId, kind, resourceId)` where `kind` is
`'layout' | 'custom_part' | 'module'`. The same shape of access rules
applies to all three: owner-user OR owner-org-membership OR explicit row in
`<kind>_collaborators`. Shared by REST handlers and the WS connection-time
authorization, so the same query is reused everywhere. (Originally would
have been a Postgres SQL function — easier as a single helper since SQLite
has no stored procs.)

### 3.4 Demo-account restrictions

A user with `is_demo_account = true` has these limits enforced in REST handlers
and the WS access check:

1. **Cannot create orgs.** `POST /api/orgs` returns 403. They can still join
   existing orgs if invited.
2. **Cannot invite others to layouts, custom parts, or modules.**
   `POST /api/{layouts|custom-parts|modules}/:id/invites` returns 403.
   They can still receive invites and use shared assets.
3. **Demo-owned layouts auto-expire.** `layouts.expires_at` is set to
   `now() + DEMO_LAYOUT_TTL` (env var, default 30 days) on insert when the
   owner is a demo account. A nightly sweeper deletes rows past their TTL.
   Transferring to a non-demo owner clears `expires_at`.

The flag is set explicitly when the bootstrap admin creates a demo account, or
auto-applied to the email/password registration form when a `DEMO_MODE` env
flag is set.

### 3.5 Layout ownership transfer

Owners can transfer a layout (`POST /api/layouts/:id/transfer`) to:
- another user (must be either themselves or the existing owner if user-owned;
  the recipient must accept via a token link before the transfer commits)
- an org they are an admin of (immediate; org admins implicitly accept)

The transfer endpoint:
- Validates the caller is the current `owner` for the layout
- For user→user transfers: writes a pending-transfer row, emails the recipient
  (or returns the link), and only commits on accept
- For user→org / org→org transfers: commits immediately and writes an
  `audit_events` row of type `transfer`
- Clears `expires_at` if the new owner is non-demo
- Updates `layouts.owner_user_id` / `owner_org_id` so the exclusive-ownership
  check still passes

## 4. Architecture

### 4.1 Single-host topology

```
   (operator's reverse proxy: Caddy / Traefik / Cloudflare / nginx)
                              │   TLS termination here
                              ▼
┌──────────────────────────────────────────┐
│  web (Fastify + Yjs WS + SQLite)         │
│   - /api/auth/*                          │
│   - /api/layouts/*                       │
│   - /api/orgs/*                          │
│   - /ws/layout/:id  ◀── y-websocket      │
│   - /parts/*       ◀── @fastify/static   │
│   - /*             ◀── SPA fallback      │
│   - in-process Yjs persistence           │
│   - SQLite file on /data volume          │
│   - backup worker writes to /backups     │
└──────────────────────────────────────────┘
```

One service in `docker-compose.yml`. Volumes:
- `/data` — SQLite file (named volume `cld-data`)
- `/backups` — backup output (named volume `cld-backups`)
- `/parts` — read-only bind mount of the `parts-library/` submodule

Operators front this container with whatever reverse proxy they already use
for TLS. We don't ship nginx in compose because we'd just be duplicating
work for anyone who's already running Caddy / Traefik / a homelab reverse
proxy.

### 4.2 Realtime data flow

When a user opens a layout:

1. Client calls `GET /api/layouts/:id` → returns metadata + `doc_version`.
2. Client opens `WS /ws/layout/:id`. Server validates session cookie + access
   role. Rejects with close code on no-access.
3. Server hydrates `Y.Doc` for this layout: load `doc_snapshot`, replay any
   `layout_updates` rows after the snapshot's version. (Cached in memory per
   active layout; LRU-evicted when no clients connected for N minutes.)
4. y-websocket handshake: server streams the current state vector, client
   sends missing updates, both sides converge.
5. Every client edit → y-update message → server broadcasts to other
   clients on this layout AND appends to `layout_updates`.
6. Awareness messages (cursor position, selection) → broadcast only, never
   persisted.
7. Snapshot worker (one per active doc): every 30s of activity, materialise
   `doc_snapshot` from current state, bump `doc_version`, delete superseded
   `layout_updates`. Idempotent.

When the last client disconnects, write a final snapshot and evict the doc
from memory.

### 4.3 Auth flow

Multi-provider via Arctic (OAuth) + a hand-rolled `sessions` table. All
providers share the same callback shape and populate `oauth_accounts` keyed
on `(provider, provider_user_id)`. Existing sessions can link a new provider
from the profile page.

- **Google OAuth** (primary): `/api/auth/google` → callback. Configured if
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars are set.
- **GitHub OAuth**: `/api/auth/github` → callback. Configured if
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` set.
- **Microsoft / generic OIDC**: `/api/auth/oidc` → callback. Configured if
  `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` set. Single
  generic OIDC client covers Microsoft work accounts, Auth0, etc.
- **Email/password** (gated): `ENABLE_PASSWORD_AUTH=true` env var lights up
  `/api/auth/password/login` and `/api/auth/password/register`. Off by default.
- **Account linking**: if a user signs in via a provider whose email matches
  an existing user, prompt-to-link rather than auto-merge (avoids account
  takeover via email collision).
- **Bootstrap admin**: on first container start, if `BOOTSTRAP_ADMIN_EMAIL`
  and `BOOTSTRAP_ADMIN_PASSWORD` are set and no user with that email exists,
  create one with global admin role. Logged loudly so operators notice.
- **Session storage**: `sessions` table, 30-day expiry, sliding refresh on
  every authenticated request. Logout deletes the row.
- **Cookie**: HTTP-only, SameSite=Lax, Secure in prod.

### 4.4 Per-user undo/redo

Yjs has a built-in `Y.UndoManager` that supports per-origin scoping.

```ts
const undoManager = new Y.UndoManager(scopes, {
  trackedOrigins: new Set([myClientId]),  // only my changes
});
```

Every transaction the client makes is tagged with its own origin id. The
UndoManager only walks back transactions matching that origin — so user A's
ctrl+Z reverses A's last edit even if user B made 5 edits afterward, and
B's edits are preserved.

Edge case: if A undoes a brick-add and B has since attached another brick
to it, the connectivity recompute on the next render will leave B's brick
floating. That's fine — it's the same behaviour the desktop has when one
user manually deletes a brick. Document it but don't try to be clever.

### 4.5 Presence indicators

Yjs *awareness* protocol — separate from doc state, not persisted.

Each client publishes:
```
{
  user: { id, displayName, avatarUrl, color },
  cursor: { x, y, layerId },        // map coords, null if not over canvas
  selection: { brickIds: [...] },   // current selection
  tool: 'select' | 'place' | ...
}
```

Clients render:
- A coloured cursor with the user's name for every other connected user
- Outlines on bricks another user has selected (their colour, semi-transparent)
- A "live" panel listing who's connected with avatar + name + status dot
- Idle detection (5min no movement → grey dot)

Colours are deterministic per-user-per-layout (hash user_id + layout_id) so
the same user always shows up as the same colour for the same map.

### 4.6 Backups (in-app)

A backup worker runs inside the `web` container on a daily cron and writes
SQLite snapshots into a `/backups` host volume using SQLite's `VACUUM INTO`
(safe vs concurrent writers — produces a consistent copy without locking).
Each snapshot is gzipped and named `cld-YYYY-MM-DD.sqlite.gz`.

**Retention policy** (enforced by the worker after each new snapshot):
- **Daily**: keep the last 7 days
- **Weekly**: keep one snapshot per ISO week for the last 3 weeks
  (the youngest snapshot inside each week is retained)
- **Monthly**: keep one snapshot per calendar month for the last 12 months
  (the youngest snapshot inside each month is retained)
- Anything older or not matching one of those buckets is deleted

The classification runs after each new snapshot so a snapshot can be promoted
from "daily" → "weekly" → "monthly" without ever leaving disk. Operators can
opt out with `BACKUPS_ENABLED=false`. The output directory is configurable
via `BACKUPS_DIR` (default `/backups` inside the container). Restore is a
manual operation: stop the container, gunzip the chosen snapshot over
`/data/cld.sqlite`, restart.

### 4.7 GitHub CI / release pipeline

Mirror the LU-Rebuilt project layout under `.github/workflows/`:

- **`ci.yml`** — runs on PRs targeting `main`. Two jobs:
  - `commit-lint`: validates every commit on the PR against the
    Conventional Commits regex (same pattern as LU-Rebuilt's `fdb-tools`).
  - `build`: pnpm install (with cache), `pnpm typecheck`, `pnpm lint`,
    `pnpm test`, then `pnpm build` for both `apps/web` and `apps/server`.
    Single Linux runner (no need for cross-platform like the C++ projects).
- **`nightly.yml`** — runs on every push to `main`:
  - Build the multi-arch Docker image (`linux/amd64` + `linux/arm64`) via
    `docker buildx`.
  - Tag and push to GHCR as `ghcr.io/<owner>/cld-web:nightly` and
    `:sha-<short>`.
  - Upload `docker-compose.yml` + `.env.example` as release assets on a
    rolling pre-release tagged `latest` (matches the LU-Rebuilt nightly
    pattern: `softprops/action-gh-release@v2` with `prerelease: true`,
    `make_latest: false`).
- **`release.yml`** — runs on `v*` tag pushes:
  - Same multi-arch image build, tagged `:vX.Y.Z` and `:latest` on GHCR.
  - Auto-generated release notes grouped by Conventional Commits type
    (Features / Bug Fixes / Performance / Documentation / Build & CI /
    Other) — same script as LU-Rebuilt's `fdb-tools/release.yml`.
  - Attach `docker-compose.yml` + `.env.example` template to the GitHub
    Release.

Conventional Commits is enforced by `ci.yml`'s `commit-lint` job; the same
regex is reused by `release.yml` to group commits in the auto-generated
notes.

### 4.8 Security scanning (defence in depth)

Layered scanning runs both locally (pre-commit) and in CI. Public details
of the policy live in `SECURITY.md`.

**Local (lefthook, installed by `pnpm install`):**
- `pre-commit` — runs `pnpm typecheck` against staged TS files; runs
  `gitleaks protect --staged` if gitleaks is on `PATH` (degrades to a
  notice if not installed)
- `commit-msg` — Conventional Commits check (same regex as CI)
- `pre-push` — full test suite (`pnpm -r test`) so a `--no-verify` on a
  pre-commit doesn't ship untested code by accident

**CI workflows:**
- **`ci.yml`** (PR-only)
  - `build`: typecheck + lint + **test** + build (test is a hard gate now
    that the suite exists)
  - `dependency-review`: blocks PRs that introduce dependencies with
    high-severity advisories or non-compatible licenses
  - `osv-scan`: full lockfile scan via OSV-Scanner (broader than `pnpm
    audit` — covers GitHub Actions versions + the JS ecosystem)
- **`codeql.yml`** — JS/TS SAST with `security-extended` query pack on
  PRs, push to main, and weekly schedule. Findings appear in the
  Security tab.
- **`secret-scan.yml`** — Gitleaks against full git history on every
  push and weekly. Custom allowlist in `.gitleaks.toml`.
- **`nightly.yml`** — adds a `scan-image` job: Trivy scans the freshly
  pushed image for `CRITICAL`/`HIGH`, uploads SARIF to code scanning,
  exit code 0 (report-only on nightly).
- **`release.yml`** — adds a Trivy gate that **fails the release** if
  the tagged image has any `CRITICAL` fixed-vuln finding. Releases
  cannot be published with known critical CVEs.

**Dependency hygiene:**
- `dependabot.yml` opens weekly PRs for npm (with grouping for
  `@types/*` and dev tools), GitHub Actions, and the Docker base image.

**Why this layering rather than one big scanner:**
- CodeQL catches code-level issues (XSS sinks, prototype pollution,
  open redirects); OSV-Scanner catches known-vulnerable deps; Trivy
  catches OS-level CVEs in the image; Gitleaks catches accidentally
  committed secrets. Each finds things the others miss.
- Local hooks are fast feedback for developers; CI is the authoritative
  gate. The same checks run in both so behaviour is predictable.

## 5. Repo layout

Monorepo, pnpm workspaces. One repo so the `.bbm` parser port can live in
`packages/bbm` and be imported by both client and server.

```
cld-web/
├── apps/
│   ├── web/                    # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── canvas/         # Konva map view
│   │   │   ├── panels/         # parts/layers/modules/etc.
│   │   │   ├── collab/         # Yjs hooks, awareness UI
│   │   │   ├── auth/           # login flows
│   │   │   ├── layouts/        # list/detail/share UI
│   │   │   ├── orgs/           # org admin
│   │   │   └── lib/            # api client, query hooks
│   │   └── public/             # favicon etc.
│   └── server/                 # Fastify backend
│       ├── src/
│       │   ├── routes/         # /api/* handlers
│       │   ├── ws/             # y-websocket integration
│       │   ├── auth/           # Arctic providers + session helpers
│       │   ├── db/             # Drizzle schema, migrations
│       │   ├── persist/        # snapshot worker
│       │   └── access/         # role-resolution helpers
│       └── migrations/
├── packages/
│   ├── bbm/                    # .bbm read/write — TS port of desktop
│   │   ├── src/Reader.ts
│   │   ├── src/Writer.ts
│   │   ├── src/Sidecar.ts
│   │   └── tests/              # round-trip fixtures (same as desktop tests)
│   ├── model/                  # shared TS types: Brick, Layer, etc.
│   ├── ydoc/                   # Yjs doc shape + helpers (createDoc, applyBbm)
│   └── parts-library-meta/     # static metadata about the bundled library
├── parts-library/              # vendored BlueBrickParts (gitignored binary,
│                               # populated by submodule or fetch script)
├── .github/
│   ├── dependabot.yml          # weekly PRs: npm + actions + docker
│   └── workflows/
│       ├── ci.yml              # PR: commit-lint + build/test + dep-review + osv
│       ├── codeql.yml          # JS/TS SAST on PR + main + weekly
│       ├── nightly.yml         # push to main: build & push :nightly + Trivy
│       ├── release.yml         # tag v*: build + Trivy gate + release notes
│       └── secret-scan.yml     # gitleaks on every push + weekly
├── lefthook.yml                # local pre-commit / commit-msg / pre-push
├── .gitleaks.toml              # secret-scan allowlist
├── SECURITY.md                 # vuln reporting + scan policy
├── docker-compose.yml          # single web service, no bundled proxy
├── Dockerfile.web              # multi-stage: build SPA + Node bundle
├── .env.example                # template — operators copy to .env
├── pnpm-workspace.yaml
└── README.md
```

## 6. Phases (each phase is shippable)

Time estimates assume one engineer working steadily; doubled if learning the
stack from scratch.

### Phase 1 — Skeleton + Auth (1.5 weeks)

- Repo scaffold, monorepo, `pnpm-workspace.yaml`
- `git submodule add` BlueBrickParts so the parts library is available
- `.github/workflows/ci.yml` — conventional-commits lint, build, test,
  dependency review, OSV-Scanner on PRs
- `.github/workflows/nightly.yml` + `release.yml` — Docker image build &
  push to GHCR (multi-arch); Trivy report (nightly) + Trivy CRITICAL gate
  (release); release-notes scaffolding from LU-Rebuilt pattern
- `.github/workflows/codeql.yml` + `secret-scan.yml` — CodeQL SAST and
  Gitleaks secret scanning
- `.github/dependabot.yml` — weekly PRs for npm + Actions + Docker base
- `lefthook.yml` + `.gitleaks.toml` — local pre-commit / commit-msg /
  pre-push hooks (typecheck, secret scan, conventional commits, tests)
- `SECURITY.md` — vulnerability reporting policy and scanning summary
- `docker compose up` → single web container, hello-world page (SQLite in volume)
- SQLite schema for users, sessions, oauth_accounts, orgs, org_members
- OAuth: Google, GitHub, Microsoft/OIDC — Arctic-based provider abstraction
  (each provider only enabled if its env vars are present)
- Account-link prompt on email collision
- Email/password gated by env flag; bootstrap admin
- Profile page (display name, avatar, linked providers, sign-out)

**Shippable:** internal demo of login / logout / who-am-I across providers,
nightly Docker image published to GHCR on every push to main.

### Phase 2 — Layout CRUD + .bbm parity (1.5 weeks)

- TypeScript port of `.bbm` reader + writer (`packages/bbm`)
- TypeScript port of sidecar reader + writer
- Fixtures from desktop repo's test suite — byte-exact round-trip
- SQLite schema: layouts, layout_collaborators, layout_invites, audit_events
- REST: `GET/POST/DELETE /api/layouts`, `GET /api/layouts/:id`
- Frontend: layouts list, create-from-blank, create-from-import
- Import = drop `.bbm` (+ optional sidecar) → parse → seed Yjs doc → save
- Export = read Yjs → write `.bbm` + sidecar `.zip`
- **No realtime yet** — single-user editing, save button writes a fresh snapshot

**Shippable:** import a `.bbm` from desktop, view + delete it on the web,
re-export to `.bbm`, byte-compare with input.

### Phase 3 — Canvas editor (2 weeks)

- Konva-based map view: grid, layers, brick rendering
- Parts panel: lazy-load thumbnails from `/parts/*`
- Tools: select, place, drag, rotate, delete (the core 5)
- Layer panel
- Per-user undo/redo via `Y.UndoManager`
- Connectivity recompute on the client (port from desktop)

**Shippable:** single-user editing in the browser, with undo/redo and save.

### Phase 4 — Realtime collab + presence (1.5 weeks)

- y-websocket server in-process with Fastify
- Yjs doc hydration from snapshot + replay; eviction on idle
- Snapshot worker (background, per active doc)
- Awareness: cursors, selection outlines, presence panel
- Connection state UI (reconnecting, offline)

**Shippable:** two browser tabs editing the same map see each other in
real time. Cursor collisions don't corrupt state. One tab offline keeps
editing locally, syncs on reconnect.

### Phase 5 — Sharing + invites (1.5 weeks)

- Layout-collaborator UI: add/remove, change role
- Invite flow: enter email → token row in `layout_invites` → return a
  shareable link AND, if SMTP is configured, send an email
- Recipient flow: link → sign in (any provider) or register → invite
  consumed → layout appears in their list
- Access enforcement: REST + WS reject if role insufficient
- Per-role UI: viewers can't drag, editors can edit but not share, owners
  can do everything
- `audit_events` rows written for `share`, `unshare`, `role_change`
- Demo-account restriction enforced: demo accounts get 403 on invite endpoint

**Shippable:** invite a friend by email or link, they sign in, see the
layout, edit alongside you.

### Phase 6 — Organizations + transfer (1.5 weeks)

- Org create + slug (demo accounts blocked from creation per §3.4)
- Org admin UI: invite, change role, remove member
- Layouts can be created in an org (owner_org_id) — role inherited from
  org membership unless explicitly overridden
- Org-level layouts list
- Layout transfer flow per §3.5:
  - User → user: pending-accept via token link
  - User → org / org → org / org → user: immediate (caller must be admin
    on both sides where applicable)
  - `audit_events` `transfer` row written on commit
  - `expires_at` cleared when transferring out of demo ownership

**Shippable:** create an org, invite teammates, store layouts at org scope,
all members can collaborate, transfer a personal layout into the org.

### Phase 6.5 — Custom parts + saved modules (2 weeks)

Extends the same ownership/sharing/transfer machinery built for layouts to
two new resource kinds. The work is mostly schema + REST + UI; the engine
already understands "fetch a part definition by id" and "instantiate a
named module" because those concepts come from the desktop port in Phase 3.

- SQLite schema: `custom_parts`, `custom_part_collaborators`, `modules`,
  `module_collaborators` (per §3.1)
- Generalise `resolveLayoutRole` → `resolveResourceRole(kind, id)`
- REST: `GET/POST/PATCH/DELETE /api/custom-parts/*` with file upload
  endpoint for `xml_blob` + `sprite_blob` (mime sniffing, max 1 MB sprite,
  validate the XML parses against the BlueBrickParts schema)
- REST: `GET/POST/PATCH/DELETE /api/modules/*`. Modules are persisted
  with the same Yjs snapshot+update-log pattern as layouts so they can be
  collaboratively edited too (a stretch goal — single-user edits are
  enough for v1).
- Frontend: parts panel groups bricks into "Bundled / My parts / Org
  parts / Shared with me" tabs; modules panel does the same
- Frontend: "Save selection as module…" command in the editor toolbar
- Sharing UIs reuse the same components as layout sharing (same
  `<ResourceShareDialog>` parameterised by resource kind)
- Audit log: `audit_events` rows for create/share/unshare/transfer on
  these new resources (event_type extended to `module_share` etc.)
- Demo-account restrictions extended: demo accounts cannot invite to
  custom parts or modules (already noted in §3.4)

**Shippable:** upload a custom part, drop it into a layout. Save a
selection as a module, share it with a teammate, they drop it into their
layout. Move a module from personal ownership to the org.

### Phase 7 — Polish + ops + mobile viewer (2 weeks)

- Deploy script docs (`docker compose -f docker-compose.prod.yml up -d`)
- TLS is the operator's responsibility — point their reverse proxy at port 3000
- Health check endpoints
- Rate-limit WS connections per user
- Demo-layout TTL sweeper job (nightly cron in the web container)
- Daily Yjs compaction job per active layout (already required by §7 risks)
- **Backup worker** per §4.6 (daily `VACUUM INTO`, gzip, retention buckets)
- Audit-log viewer UI (per-layout history page; owners + org-admins only)
- **Read-only mobile viewer**: responsive layout-list page; on small screens
  the editor route renders a pan/zoom canvas with no tools, no awareness
  cursors, no edit affordances. Reuses Konva but with a stripped tool layer.
- Tag the first `v1.0.0` release — verifies `release.yml` end-to-end

**Shippable:** production-ready single-host deploy with mobile-viewable
layouts, per-layout audit history, automatic backups with retention, and
a published `v1.0.0` Docker image.

**Total: ~12.5 weeks for a working v1.** Phases 1–4 (~6.5 weeks) get you a
single-org collaborative editor; phases 5–7 (~6 weeks) add multi-tenant
sharing, transfer, audit, custom parts, reusable modules, mobile viewing,
backups, and ops.

## 7. Risks & open questions

### Risks
- **Konva perf with thousands of bricks.** Big layouts on the desktop have
  10k+ bricks. Konva is fine up to ~2k complex shapes per layer; beyond
  that we need to switch render strategy (off-screen canvas tiles, or
  batched draw with a single Konva.Layer + custom hit testing). De-risk
  in the day-1 spike using the **largest real fixture from desktop's
  `fixtures/bbm-corpus/`** (not synthetic dummy bricks).
- **`.bbm` byte-exact round-trip.** Desktop CLD enforces this with property
  tests against `tests/saveload/RoundTripTest.cpp` + `fixtures/bbm-corpus/`.
  The TS port has to do the same; XML formatting quirks (attribute order,
  whitespace, CRLF, 2-space indent) will burn hours if not pinned to
  fixtures from day one. Reuse the desktop fixture corpus directly.
- **`.bbm.cld` sidecar JSON round-trip.** Sidecar is JSON, not XML — schema
  documented at `docs/bbm-cld-schema.md` in the desktop repo. Web round-trip
  must preserve unknown keys (forward-compat) and regenerate `bbmHashSha256`
  on every export.
- **Yjs persistence size.** Long-running docs accumulate update history.
  Snapshot+compact every 30s of activity, AND schedule a daily full
  rewrite per active layout to keep the binary blob lean. **Daily compaction
  is essential, not optional.**
- **Connectivity recompute on every Yjs update.** Mitigated by porting
  desktop's O(N) spatial-bucketing algorithm; debounce until drag/move
  settles to avoid wasted work mid-gesture.
- **Email delivery.** App always supports copy-paste invite links; SMTP is
  optional. If `SMTP_*` env vars are set, also send the email via Nodemailer.
  This means invites work in any deployment.

### Decisions locked at planning time
- **Database**: SQLite (WAL mode) for v1; Drizzle schema kept portable so a
  swap to Postgres later is a driver change, not a rewrite.
- **Parts library**: git submodule of upstream BlueBrickParts (same as desktop).
- **Auth providers**: Google + GitHub + Microsoft/OIDC + email-password (gated).
- **Mobile**: read-only viewer (pan/zoom) on small screens; no touch editing.
- **Audit log**: full version — log every persisted action via `audit_events`.
- **Layout transfer**: yes, in v1 (see §3.5).
- **Custom parts**: user-owned (private + per-user share) and org-owned;
  uploaded as XML + sprite. No instance-wide public library in v1.
- **Saved modules**: first-class shareable assets (private + per-user
  share + org-owned). Promotes desktop's embedded `Module` to a top-level
  resource that can be reused across layouts.
- **Demo accounts**: cannot create orgs, cannot invite, layouts auto-expire
  (see §3.4).
- **Backups**: in-app worker, daily snapshots via `VACUUM INTO`. Retention =
  last 7 days + one per week for 3 weeks + one per month for 12 months
  (see §4.6).
- **Email**: copy-paste link always; SMTP layered on if configured.
- **CI/CD**: GitHub Actions — `ci.yml` (PR build/lint/test + dependency
  review + OSV), `nightly.yml` (image push + Trivy report), `release.yml`
  (tagged release with auto-notes + Trivy CRITICAL gate).
- **Security scanning** (see §4.8): CodeQL + OSV-Scanner + Gitleaks +
  Trivy + Dependabot in CI; lefthook hooks (typecheck, gitleaks, commit-msg,
  full tests on push) locally.
- **Spike data**: largest real `.bbm` fixture from desktop corpus.

### Open questions (call before each phase that touches it)
- **Phase 2:** is sidecar export inside a `.zip` (with `.bbm`) or two
  separate downloads? Desktop puts them side-by-side on disk; web users
  expect one download. Default to `.zip`.
- **Phase 3:** which tools land in v1? Full desktop parity is huge — the
  core 5 (select/place/drag/rotate/delete) is enough to demo collab. Text
  tool, area tool, ruler tool can wait.
- **Phase 4:** do we need an "everyone editing has to be online" guarantee,
  or is offline-Yjs-on-reconnect acceptable? Default offline is fine but
  the merge UI for the user who was offline needs thought (just show a
  toast?).

## 8. What I'd build first if I had one day

A throwaway spike to de-risk the riskiest unknowns:

1. Scaffold pnpm monorepo, `docker compose up`
2. Stand up SQLite + Fastify + a `/api/health` endpoint
3. Wire Arctic + Google OAuth + the `sessions` cookie helper, log in / out
4. Load the **largest real fixture** from desktop's `fixtures/bbm-corpus/`
   into a Konva canvas; measure FPS while panning + zooming. This is the
   real worst case — synthetic 2000 dummy bricks don't capture the
   distribution of part shapes/sizes a real layout has.
5. Open a Yjs doc between two browser tabs, drag a brick, watch the other
   tab move it

If steps 4 and 5 work cleanly, the rest is execution. If 4 is sluggish,
revisit the rendering strategy before phase 3 begins.
