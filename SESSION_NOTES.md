# Session notes — Phase 4 ready to commit

> Living document. Move into PLAN.md / commit messages once it's no
> longer needed.

## Commits

- **`4de0b70`** — initial scaffold (Phases 1, 2, Phase 3 m1).
- **`2b30dad`** — Phase 3 m2: editor scaffold, Yjs projection.
- **`29511af`** — Phase 3 m3: connectivity active, marquee, multi-drag,
  ghost preview.
- *(this commit)* — Phase 4: realtime collab via y-websocket, awareness
  cursors/selection, presence panel.

## Phase 4 — Realtime collab (this session)

**Server-side:**
- `apps/server/src/ws/docHub.ts` — DocSession hub. Per-layout in-memory
  Y.Doc + Awareness. Hydrate from `layouts.docSnapshot`, replay any
  unflushed `layout_updates`, persist every WS update, flush snapshot
  every 30s or on last-client detach. 60s eviction grace.
- `apps/server/src/ws/handler.ts` — y-websocket protocol via
  `y-protocols/sync` + `y-protocols/awareness`. Routes incoming sync
  steps + awareness updates, broadcasts to peers, tags origins so we
  don't echo back to the sender.
- `apps/server/src/routes/ws.ts` — `GET /ws/layout/:id` upgrade
  endpoint. Reuses `attachUser` for session-cookie auth, then
  `resolveResourceRole` for per-layout access. Per-user 8-WS cap.
- Snapshot worker started in `wsRoutes` registration; stopped on
  Fastify `onClose`.

**Client-side:**
- `apps/web/src/editor/useLayoutDoc.ts` rewritten as a thin
  `y-websocket` `WebsocketProvider` shim. Removes the Phase-3
  snapshot fetch / save. SaveStatus: connecting / synced /
  reconnecting / offline / error. Cmd-S is a no-op (every edit is
  saved).
- `apps/web/src/editor/awareness.ts` — types + `deterministicColor`
  (8-colour palette, hashed from `userId:layoutId`).
- `apps/web/src/editor/useAwareness.ts` — `usePublishAwareness` reads
  editor store + dispatched cursor events; sets `awareness.localState`
  on every change. `useRemotePeers` returns a sorted list of remote
  peers (excluding our clientID) with `isIdle: lastActivityMs > 5min`.
- `apps/web/src/editor/PresencePanel.tsx` — sidebar/header strip,
  shows everyone connected with their colour dot + name + idle status.
- `apps/web/src/editor/render/RemoteCursors.tsx` — Konva layer
  rendering each peer's cursor (arrow + name pill in their colour) +
  semi-transparent outlines on bricks they've selected.
- Stage `onMouseMove` dispatches a `cld-cursor-move` window event;
  `usePublishAwareness` listens and feeds it into awareness state.

**Server-start fix:**
- `apps/server/package.json` `start` script switched from
  `node dist/index.js` to `tsx src/index.ts` so the workspace `.ts`
  imports work at runtime without a pre-build (matches what `pnpm dev`
  was already doing). Dockerfile CMD changed to `pnpm start`.

## Test totals (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 20 web (10 mutations + 4 marquee + 2 web tests + 4 awareness)
- 42 server (5 new docHub tests)
- = **131 passing**

## Smoke-test recipe (next session, before declaring Phase 4 done)

1. `cd apps/server && pnpm dev` (port 3000, with
   `ENABLE_PASSWORD_AUTH=true` and a fresh DB).
2. `cd apps/web && pnpm dev` (port 5173, proxies /api and /ws).
3. Open http://localhost:5173/, register two accounts in two browser
   profiles (or one Chrome tab + one incognito tab).
4. Owner imports `tight-corner.bbm`, then Owner shares with the second
   account: at the moment Phase 5 hasn't shipped, so manually grant
   collaborator role via DB:
   ```sh
   sqlite3 ./data/cld.sqlite \
     "INSERT INTO layout_collaborators (layout_id, user_id, role, added_at)
      VALUES ('<layout-id>', '<bob-user-id>', 'editor', strftime('%s','now')*1000);"
   ```
5. Both sessions click Open on the layout.
6. Verify:
   - Both sessions see "synced" in the status indicator.
   - Both sessions see each other in the PresencePanel header.
   - Cursor moves from one tab show up live in the other.
   - Selecting a brick in tab A shows a coloured outline in tab B.
   - Placing/moving/deleting bricks in either tab propagates instantly.
   - Closing tab A removes their cursor + presence dot from tab B.
   - Briefly disconnecting WiFi while editing tab A shows "offline";
     reconnecting flushes the offline edits to tab B without loss.

## Known gaps for the next session

1. **Manual two-tab smoke** as above.
2. **No POST /api/layouts/:id/snapshot/flush** — explicit Save button
   is a no-op now. Either remove the button (less confusing) or wire a
   force-flush REST that calls `docHub.getOrCreate(id).flushSnapshot()`.
3. **Daily compaction job** mentioned in PLAN.md §4.6 not yet built.
   Phase-4 snapshot worker handles "every 30s of activity"; the
   "daily full rewrite" cron is a Phase 7 task.
4. **Awareness is not authenticated** beyond the WS connection itself.
   A peer could in theory set their `user.displayName` to whatever
   they want in awareness state. Phase 5 will validate that the
   awareness `user.id` matches the WS-authenticated user.
5. **No per-message viewer enforcement.** Viewer can SEE updates but
   the server doesn't block them from sending sync updates. Phase 5
   adds that gate via `role === 'editor' || role === 'owner'`.

## What's next (Phase 5)

Per PLAN.md (1.5 weeks):
- Layout-collaborator UI: add/remove, change role
- Email invite flow (link by default, SMTP if configured)
- REST + WS access enforcement per role
- Per-role UI: viewer can't drag, editor can edit but not share, etc.
- Demo-account 403 on invite endpoint
- audit_events rows for share / unshare / role_change
