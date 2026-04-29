# Session notes — Phase 6 ready to commit

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
| *(this commit)* | 6 | Organisations + layout transfer + WS role-revalidate |

## Phase 6 (this session)

**Schema (apps/server/src/db/schema.ts + migration 0003):**
- `org_invites` — token + recipient email + invite role (admin/member),
  TTL, accepted_at; mirrors layout_invites.
- `layout_transfers` — pending user→user transfer tokens. Org-recipient
  transfers commit immediately and never write to this table.

**Server (apps/server/src/routes/):**
- `orgs.ts` — POST /api/orgs (creator becomes admin; slug validated;
  demo accounts blocked); GET list/get/members/layouts; PATCH/DELETE
  members + invite + revoke; last-admin guard everywhere.
- `orgInvites.ts` — preview + email-match accept.
- `transfers.ts` — POST /api/layouts/:id/transfer (specify either
  recipientEmail OR recipientOrgSlug, not both). Org-recipient =
  immediate; user-recipient = token + email-match accept. Source-org
  layouts cannot transfer to a user (prevents extraction). Self-transfer
  rejected. Previous owner becomes editor on accept.
- `layouts.ts` — POST /api/layouts gained optional `orgSlug` (org
  membership required); GET list joins org-membership so org-owned
  layouts surface in member views.
- `ws/handler.ts` — 30s `resolveResourceRole` poll. Closes WS with
  4404 on access revocation; live role updates in-memory for sync
  gating.

**Web (apps/web/src/):**
- `api.ts` — `api.orgs.*`, `api.orgInvites.*`, `api.transfers.*`.
- `orgs/OrgsPage.tsx` — list + new-org dialog.
- `orgs/OrgDetailPage.tsx` — members panel, invite form,
  pending-invites list, org-owned layouts list.
- `orgs/OrgInvitePage.tsx` — /org-invite/:token landing.
- `layouts/TransferPage.tsx` — /transfer/:token landing.
- `layouts/LayoutsPage.tsx` — CreateLayoutDialog has an owner select
  (personal vs org).
- `layouts/ShareDialog.tsx` — owner-only `TransferSection` with
  user/org modes. Org transfers show "transferred to X"; user
  transfers show the copy-link.
- `App.tsx` — top-nav "Organisations" link.
- `main.tsx` — routes for /orgs, /orgs/:slug, /org-invite/:token,
  /transfer/:token.

## Tests passing (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 20 web
- 70 server (was 50 + 12 orgs + 8 transfers)
- = **159 passing**

## How to resume / verify

```sh
git status                                    # clean
git log --oneline -7                          # 7 commits
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Smoke test the full flow:
1. Register Alice + Bob in two browsers.
2. Alice creates org "acme" (top-nav → Organisations → New org).
3. Alice invites Bob as member (Org page → Invite). Copy link.
4. Bob pastes link → /org-invite/<token> → auto-accepts → /orgs/acme
   shows Bob as member.
5. Alice imports tight-corner.bbm with Owner=Acme. The new layout
   appears in /orgs/acme and in both Alice's and Bob's main layouts
   list (because Bob is a member).
6. Both edit it live (Phase 4 collab still works via the org-derived
   editor role).
7. Alice opens ShareDialog → TransferSection → "Transfer to a user" →
   carol@example.com. Pending link returned. Alice copies it. Carol
   registers, opens the link, becomes the new owner. Alice stays as
   editor.
8. WS revalidation: Alice removes Bob from the org. Bob's open editor
   tab (which is on an org-owned layout) closes within 30 seconds with
   "access_revoked".

## Known follow-ups for Phase 7

1. **Audit-log read UI** — rows are being written for share/unshare/
   role_change/transfer; no /api/layouts/:id/audit endpoint or panel
   yet.
2. **Backup worker (PLAN.md §4.6)** — daily VACUUM INTO + retention
   buckets.
3. **Demo TTL sweeper** — nightly cron deleting expired
   demo-owned layouts.
4. **Mobile read-only viewer** — pan/zoom on small screens.
5. **Place-time snap-to-connection-point hint** + connection-point
   markers visualisation (Phase 3 deferred items).
6. **TLS deploy docs** + first `v1.0.0` tag.
7. **Awareness identity validation** — server-side overwrite of
   awareness `user.id` to match the WS-authenticated user (currently
   client-trusted).
8. **Phase 6.5** — custom parts + saved modules (own ownership +
   sharing tiers, schema sketched in PLAN.md §3.1).

## Context for next session

The `layout_transfers` row is currently a one-shot ("pending → accepted"
or revoked). There's no transfer-history table beyond `audit_events`,
so audit is the only canonical record. That's intentional and fine for
v1; if/when we want a "transfers requested by me" view, this is the
shape that needs adding.

Slug validation accepts only lowercase a-z, 0-9, hyphens; 1–40 chars.
The handler lowercases input before validation, so "Acme" → "acme"
gets accepted. Reject pattern: spaces, underscores, leading/trailing
hyphens, >40 chars.

`resolveResourceRole` already returns `'editor'` for org members on
org-owned layouts and `'owner'` for org admins. No code change needed
for org-derived roles in Phase 6 — that helper has been correct since
Phase 2.
