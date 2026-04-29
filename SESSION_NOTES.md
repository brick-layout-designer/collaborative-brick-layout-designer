# Session notes — overnight session summary

> Living document. Move into PLAN.md / commit messages once it's no
> longer needed. As of this snapshot, Phases 1–5 of PLAN.md ship.

## What landed overnight

5 commits, 5 phases, 139 tests passing.

| Commit  | Phase | One-line summary |
|---------|-------|--------------------|
| `4de0b70` | 1 + 2 + 3m1 | Initial scaffold: auth, .bbm parser, layouts, parts catalog, connectivity recompute (98 tests) |
| `2b30dad` | 3m2 | Canvas editor: Yjs projection, tools, undo/redo, snapshot REST (116 tests) |
| `29511af` | 3m3 | Connectivity active, marquee, multi-drag, ghost preview, sprite-aware sizing (122 tests) |
| `3c0211f` | 4 | Realtime collab via y-websocket, awareness cursors/selection, presence panel (131 tests) |
| `9580892` | 5 | Sharing + invites, role-aware UI, viewer WS enforcement, audit log writes (139 tests) |

## Project shape now

```
apps/
  server/    Fastify + SQLite + Drizzle, multi-provider auth (Google/
             GitHub/OIDC/password), layout CRUD + import/export, .bbm
             round-trip, /api/parts/catalog, /ws/layout/:id (y-ws server),
             collaborator/invite REST, audit log, SMTP best-effort.
  web/       React + Vite + Tailwind + TanStack Query + Konva + Yjs.
             /login, /profile, /link, /invite/:token, /editor/:id.
             ShareDialog + presence panel + remote cursors.
packages/
  model/         Typed BbmMap data model.
  bbm/           .bbm reader + writer + .bbm.cld sidecar.
  parts-catalog/ BlueBrickParts XML scanner + connectivity recompute.
  ydoc/          Yjs ↔ BbmMap projection.
parts-library/   git submodule (BlueBrickParts, ~26 MB).
.github/
  workflows/    ci, codeql, secret-scan, nightly (Trivy report),
                release (Trivy gate).
  dependabot.yml
SECURITY.md   policy + scan matrix
PLAN.md       master plan (still authoritative)
```

## How to resume / verify the state

From the repo root:

```sh
git status                                    # clean
git log --oneline -5                          # 5 commits
pnpm -r typecheck                             # all green
pnpm -r test                                  # 139 passing
pnpm -r build                                 # all build
```

## How to run

Local dev (two terminals):
```sh
# Terminal 1
pnpm --filter @cld/server dev
# Terminal 2
pnpm --filter @cld/web dev
```
Visit http://localhost:5173. With `ENABLE_PASSWORD_AUTH=true` in
`apps/server/.env`, you can register accounts directly. Without
SMTP env vars, invites still work via the copy-paste link in the
ShareDialog response.

Docker:
```sh
docker compose up --build
```
Single container (no bundled proxy — bring your own TLS).

## Manual smoke-test recipes

**Phase 4 + 5 combined smoke test:**
1. Register Alice + Bob in two browsers.
2. Alice imports `packages/bbm/tests/fixtures/tight-corner.bbm`, opens
   the editor, places a few new bricks.
3. Alice clicks Share, invites bob@example.com as editor → copy link.
4. Bob pastes the link. Auto-accept. Editor opens. Both tabs see
   each other's cursors, selections, edits in real time.
5. Alice changes Bob to viewer. Bob refreshes. Bob's editor shows
   "View only" — no toolbar, no parts panel, no drag/place.
6. Alice removes Bob. Bob refreshes the layouts page; the layout is
   gone.

## Open follow-ups (still need work)

1. **Audit log read UI** — rows are being written; no `/api/layouts/:id/audit`
   endpoint or panel yet. Phase 7.
2. **WS doesn't auto-disconnect on role drop** — a removed user with
   an open WS continues until refresh. Easiest fix: a periodic
   role-revalidation tick in `attachWsHandlers`.
3. **Awareness identity is unauthenticated** — peers could claim a
   different displayName client-side. Server should overwrite/validate
   awareness `user.id` against the authenticated session.
4. **Daily compaction job** — Phase 4 snapshot worker handles "every
   30s of activity"; the daily full-rewrite cron is Phase 7.
5. **Backup worker** — Phase 7. SQLite VACUUM INTO + retention buckets
   per PLAN.md §4.6.
6. **Mobile read-only viewer** — Phase 7. Pan/zoom canvas only on
   small screens.
7. **Phase 6** (orgs + transfer) — entirely deferred.
8. **Phase 6.5** (custom parts + saved modules) — deferred.

## What's next (Phase 6 — Organisations + transfer, ~1.5 weeks)

Per PLAN.md:
- `POST /api/orgs` (slug, demo accounts blocked).
- Org members table is already in the schema; need invite +
  role-change UI.
- Layouts can be created with `owner_org_id`. The
  `resolveResourceRole` helper already handles org-membership joins.
- Layout transfer flow per PLAN.md §3.5:
  - User → user: pending-accept via token link.
  - User → org / org → org / org → user: immediate.
  - audit_events `transfer` row on commit.
  - `expires_at` cleared when leaving demo ownership.
- Org-level layouts list page.

After Phase 6: Phase 6.5 (custom parts + modules) and Phase 7 (polish,
backups, audit UI, mobile viewer, daily compaction, first `v1.0.0`
release).

## Notes for me / the next session

- The bbm package's test fixtures (`packages/bbm/tests/fixtures/*.bbm`)
  are vendored from the desktop repo. They drift if the desktop
  re-emits — re-vendor when convenient.
- The web app's bundle is now ~650KB minified (210KB gzipped).
  Vite warns about chunks > 500KB; defer code-splitting until
  there's a measurable load problem.
- Lefthook was running on every commit tonight (typecheck pre-commit,
  tests pre-push). Both passed cleanly throughout — the testing
  story is in good shape going into Phase 6.
- All `node:fs` and `node:crypto` references have been carefully
  walled off into server-only entrypoints (`@cld/bbm/hash`,
  `@cld/parts-catalog`'s default vs `/browser`). The web bundle
  builds without Node shims.
