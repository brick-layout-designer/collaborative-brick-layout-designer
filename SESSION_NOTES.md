# Session notes — Phase 6.5 ready to commit

> Living document. Move into PLAN.md / commit messages once it's no
> longer needed.

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
| *(this commit)* | 6.5 | Custom parts + saved modules |

## Phase 6.5 (this session)

**Schema (apps/server/src/db/schema.ts + migration 0004):**
- `custom_parts` — XML + sprite blobs, owner (user XOR org), createdBy.
- `custom_part_collaborators` — same shape as layout_collaborators.
- `modules` — title, owner, Y.Doc snapshot + version + optional
  sidecar.
- `module_collaborators`.

**Access (apps/server/src/access/resolveResourceRole.ts):**
- Now dispatches by `kind: 'layout' | 'custom_part' | 'module'`.
  Identical role-resolution algorithm; just different table joins.

**Server (apps/server/src/routes/):**
- `customParts.ts` — list/get/create/delete + sprite+xml byte
  endpoints + share (immediate add for known recipients,
  pending-link for unregistered) + role change + remove + leave.
  4MB cap, gif/png mime, demo-gated invites, partNumber unique per
  owner.
- `modules.ts` — list/get/create/rename/delete + snapshot GET/PUT
  + share + remove. Octet-stream snapshot bodies, 50MB cap, viewer
  PUT → 403, demo-gated invites.

**Web (apps/web/src/):**
- `api.ts` — `api.customParts.*`, `api.modules.*`.
- `library/LibraryPage.tsx` — combined view: thumbnail grid for
  custom parts (sprite from `/api/custom-parts/:id/sprite`), list
  for modules. Upload-part dialog with org owner picker.
  New-module dialog. Per-row delete.
- `App.tsx` — top-nav "Library" link.
- `main.tsx` — `/library` route.

## Tests passing (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 20 web
- 85 server (was 70 + 9 customParts + 6 modules = 15 new)
- = **174 passing**

## How to resume / verify

```sh
git status                                    # clean
git log --oneline -8                          # 8 commits
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Smoke test:
1. Register Alice. Create org "acme" (top-nav → Organisations → New).
2. Top-nav → Library. Upload a custom part (XML + sprite GIF). Owner
   defaults to personal; pick the org if you'd like it shared with
   members.
3. Create a saved module. Title only — module bytes are seeded as an
   empty Y.Doc.
4. Register Bob, invite him to the org as member. Bob now sees both
   org-owned items in Library.
5. Sharing a personal part: API only currently — no web UI for the
   share dialog beyond owner-org selection at create time. The
   custom-parts share endpoint immediately adds a registered
   recipient; non-registered returns a copy-link (no DB persistence
   yet — see Phase 7 follow-up).

## Known limitations / Phase 7 follow-ups

1. **Editor doesn't surface custom parts yet.** They're listed in
   `/library` but the in-editor parts panel pulls from
   `/api/parts/catalog` only. Phase 7 wires custom parts into the
   parts panel under "My parts" / "Org parts" tabs.
2. **Modules can't be placed yet.** No "instantiate this module"
   command in the editor toolbar. Phase 7.
3. **Custom-part share for unregistered recipients lacks a DB row.**
   The endpoint returns a token+URL but the token isn't persisted, so
   the recipient can't actually accept. Phase 7 adds
   `custom_part_invites`.
4. **No transfer for custom parts / modules.** Layout transfer works
   end-to-end; custom parts and modules don't have transfer endpoints
   yet.
5. **No audit log writes for these new resources.** Layout
   share/unshare/role_change/transfer all hit `audit_events`; the
   parts/modules paths don't yet.
6. **Module realtime collab.** Modules use snapshot REST only — no WS
   server. Editing happens single-user.

## Phase 7 priorities (when we get there)

1. Editor integration of custom parts (parts panel) and modules
   (instantiate-from-library).
2. `custom_part_invites` for unregistered recipients.
3. Audit log writes for custom-part / module events.
4. Audit log read UI (per-layout / per-resource history).
5. Daily compaction job (the 30s snapshot covers active editing).
6. Backup worker (PLAN.md §4.6).
7. Demo TTL sweeper (nightly cron).
8. Mobile read-only viewer.
9. TLS deploy docs + first `v1.0.0` tag.
10. Awareness identity validation.
