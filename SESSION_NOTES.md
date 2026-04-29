# Session notes — v1.x backlog ready to commit

> Living document. After tagging v1.1.0 (or when this batch lands) the
> PLAN remains the canonical record.

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
| *(prev)* | 7 | Polish: audit log, workers, awareness ID, mobile viewer |
| *(this commit)* | 7.x | v1.x backlog: editor custom parts, module insert/transfer, audit panel, custom-part invites, org audit, retention tests |

## v1.x backlog (this session)

Picks up where the v1.0.0 candidate notes left off. Each item is one of
the deferred entries from the Phase 7 backlog, now shipped:

**Editor integration of custom parts:**
- `/api/parts/catalog` merges per-user custom parts (personal + org-owned
  + collab-shared) into the response.
- New `PartWire.source` discriminator (`'bundled' | 'custom'`) and
  `PartWire.customPartId`. Per-user ETag (`<base>-u-<id-slice>-<count>`)
  so fresh uploads bust only that user's cached catalog.
- Web `spriteUrlFor(part)` resolver in `apps/web/src/api.ts`. Editor's
  PartsPanel / BrickLayer / PlaceGhost / EditorPage all switched to it.

**Module instantiation in the editor:**
- New `apps/web/src/editor/InsertModuleDialog.tsx`. Fetches
  `/api/modules/:id/snapshot`, decodes via `Y.applyUpdate`, projects via
  `docToBbm`, walks brick layers, batch-inserts via a new
  `insertBricks(doc, layerId, bricks, offset)` mutation.
- `insertBricks` is single-transaction with freshly minted ids so undo
  treats the whole insert as one operation.

**Custom-part invites for unregistered recipients:**
- Migration `0006_mean_christian_walker.sql` adds `custom_part_invites`
  (id, custom_part_id, invited_email, role, token, expires_at, accepted_at).
- `apps/server/src/routes/customParts.ts` now persists a row when the
  email isn't registered + writes an audit event.
- New `apps/server/src/routes/customPartInvites.ts` — GET preview + POST
  accept with email-match check, mirroring the layout invite shape.

**Audit log read UI:**
- `ShareDialog` gains an `AuditPanel` (collapsed `<details>`) between
  the transfer section and collaborator list. Newest-first, with
  `summarisePayload` rendering human-readable strings (e.g., "shared with
  bob@... as editor", "removed alice@...").

**Module transfer:**
- Migration `0007_right_havok.sql` adds `module_transfers`.
- New `apps/server/src/routes/moduleTransfers.ts` mirrors `transfers.ts`
  for layouts: org-recipient is immediate, user-recipient is pending
  token. Previous owner becomes editor on user→user accept.

**Org as a first-class audit kind:**
- `resolveResourceRole` short-circuits `kind === 'org'` to membership:
  admin → owner, member → editor, non-member → null.
- `routes/audit.ts` accepts `?kind=org`.
- `routes/orgs.ts` writes audit rows for create / invite / role_change /
  member-remove.

**Workers fixture-driven tests:**
- Pure helpers extracted to `apps/server/src/workers/retention.ts`:
  `parseBackupDate`, `isoWeekKey`, `classifyBackups(files, now)`.
- New `workers/retention.test.ts`: 10 tests covering parse, ISO-week
  grouping, daily window, weekly bucket invariants (no two kept files
  in the same ISO week within the 8..21-day window), monthly window,
  drop-after-12-months, ignore non-matching filenames, empty input.
- `workers/index.ts` now delegates `applyRetentionPolicy` → `classifyBackups`.

## Test totals (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 23 web (was 20; +3 mutations for `insertBricks`)
- 103 server (was 92; +10 retention + 1 audit org-test reframe)
- = **195 passing**

## How to verify

```sh
git status                                    # clean after commit
git log --oneline -10                         # ten commits
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

## Tag plan

After this commit: optional `v1.1.0` tag if marking the batch as a
release. The tag fires `release.yml` (multi-arch build, Trivy gate,
auto-notes, attaches `docker-compose.yml` + `.env.example`). Skip the
tag if accumulating into a larger v1.1 release.

```sh
git tag -a v1.1.0 -m "v1.1.0 — editor integration, module transfer, audit UI"
# push when ready: git push origin v1.1.0
```

## Still deferred (v1.2+)

- Module realtime collab over WS (single-user is sufficient for v1).
- Instance-wide public parts/modules library (moderation + versioning
  unsolved).
- Touch-first editing on mobile (read-only viewer is intentional v1
  scope).
- `audit_events` retention/pruning policy (currently grows unbounded).
- Public part attribution / licensing fields on `custom_parts`.

## Ops checklist for first deploy

- [ ] Set `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD`.
- [ ] Mount `/data` and `/backups` to host volumes (compose does this).
- [ ] Optional: SMTP env for email invites.
- [ ] Optional: OAuth provider env (Google/GitHub/OIDC).
- [ ] Front with TLS (Caddy / Traefik / Cloudflare).
- [ ] Verify `/api/health/ready` returns 200 externally.
