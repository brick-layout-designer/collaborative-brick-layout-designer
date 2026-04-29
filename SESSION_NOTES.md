# Session notes — Phase 7 ready to commit (v1.0.0 candidate)

> Living document. After the v1.0.0 tag this can be deleted; the PLAN
> serves as the canonical record.

## Commits to date

| Commit  | Phase | Headline |
|---------|-------|--------------------|
| `4de0b70` | 1+2+3m1 | Initial scaffold, auth, .bbm parser, layouts, parts catalog |
| `2b30dad` | 3m2 | Canvas editor + Yjs projection |
| `29511af` | 3m3 | Connectivity, marquee, multi-drag, ghost preview |
| `3c0211f` | 4 | Realtime collab via y-websocket |
| `9580892` | 5 | Sharing + invites + role enforcement |
| `c3929c9` | docs | Overnight summary |
| `b0ed31f` | 6 | Organisations + layout transfer + WS revalidate |
| `fad8801` | 6.5 | Custom parts + saved modules |
| *(this commit)* | 7 | Polish: audit log, workers, awareness ID, mobile viewer |

## Phase 7 (this session)

**Audit log:**
- Schema generalised to `(layout_id) | (resource_kind, resource_id)`.
  Migration 0005 recreates the table to drop NOT NULL on layout_id.
- `writeAuditEvent` supports both shapes. Custom-part and module
  endpoints emit `create / share / role_change / unshare / delete`.
- Read APIs: `/api/layouts/:id/audit` and `/api/audit?kind=&id=`.

**Workers (apps/server/src/workers/index.ts):**
- Daily tick (60s startup grace, then 24h interval). Each job
  toggleable via env: `DEMO_TTL_SWEEP_ENABLED`,
  `DAILY_COMPACTION_ENABLED`, `BACKUPS_ENABLED`.
- Demo TTL sweep — hard-delete past-expires_at layouts.
- Daily compaction — same logic as docHub flushSnapshot but for
  layouts that aren't being actively edited.
- Backup worker — `VACUUM INTO` + gzip + retention-bucket cleanup
  (last 7 days + 1/wk×3wk + 1/mo×12mo).

**Security/UX:**
- Awareness identity validation in `ws/handler.ts` — overwrites
  `state.user.id` with the authenticated user when a peer's
  awareness change came from THIS WS but claims a different id.
- `useViewportSize` adds `isMobile` (< 768px). EditorPage forces
  read-only on mobile + collapses the sidebar grid column.
- `/api/health/ready` deep health check that pings the DB.

## Test totals (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 20 web
- 92 server (was 85; +5 audit + 2 health = 7 new)
- = **181 passing**

## How to verify

```sh
git status                                    # clean
git log --oneline -9                          # 9 commits
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

## Tag plan

After this commit, tag `v1.0.0`. The tag fires `release.yml`:
- multi-arch image build → GHCR `:v1.0.0` and `:latest`
- Trivy gate (fails release on CRITICAL CVE)
- auto-generated release notes grouped by Conventional Commits type
- attaches `docker-compose.yml` + `.env.example`

```sh
git tag -a v1.0.0 -m "v1.0.0 — initial release"
# push when ready: git push origin v1.0.0
```

## Phase 7 deferred / v1.x backlog

1. **Editor integration of custom parts** — Library page lists them
   but the in-editor parts panel pulls only `/api/parts/catalog`.
2. **Module instantiation in the editor** — no "drop module into
   layout" command yet.
3. **Custom-part invites for unregistered recipients** — endpoint
   returns 202 + token but no `custom_part_invites` table to persist.
4. **Audit log read UI** — backend serves data; no editor panel yet.
5. **Module transfer** — layouts have transfer; modules don't.
6. **Org audit events** — `resource_kind: 'org'` accepted by the
   schema but no callers write org events; audit endpoint refuses
   `?kind=org` until both sides land.
7. **Workers tests** — retention-bucket math + ISO-week + gzip
   pipeline currently exercised only in production. v1.1 fixture
   harness.

## Ops checklist for first deploy

- [ ] Set `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD`.
- [ ] Mount `/data` and `/backups` to host volumes (compose does this).
- [ ] Optional: SMTP env for email invites.
- [ ] Optional: OAuth provider env (Google/GitHub/OIDC).
- [ ] Front with TLS (Caddy / Traefik / Cloudflare).
- [ ] Verify `/api/health/ready` returns 200 externally.
