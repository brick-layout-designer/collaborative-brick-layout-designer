# Session notes — Phase 3 milestone 2 ready to commit

> Living document. Updated as work progresses so the next session can
> pick up cleanly. Move into PLAN.md / commit messages once Phase 3 ships.

## Commits so far

- **`4de0b70`** — initial scaffold (Phases 1, 2, Phase 3 milestone 1).
  Monorepo + auth + layouts + .bbm parser + parts catalog + connectivity.
  98 tests passing.

## Phase 3 milestone 2 — Editor (this session)

**What's done:**

- `@cld/parts-catalog` split into `./` (Node, has fs scanner) and
  `./browser` (browser-safe — types + parser + connectivity)
- `@cld/bbm` similarly split: `./` (full), `./browser` (no node:crypto),
  `./hash` (the SHA-256 helper, server-only)
- `@cld/ydoc/projection` — full Yjs ↔ BbmMap projection. Replaces the
  Phase-2 `bbmCache` shortcut. Round-trips losslessly through the binary
  y-update path, verified by tests against both vendored fixtures.
- `apps/web` deps: Konva 9.3.16, react-konva 18.2.10, yjs 13.6.18, all
  `@cld/*` workspace packages
- **Editor route** at `/editor/:id`:
  - `useLayoutDoc` hydrates from `GET /api/layouts/:id/snapshot`,
    tracks dirty state, debounced 2s auto-save, exposes `saveNow`.
  - `useUndoManager` binds `Y.UndoManager` to `layerData` with
    `trackedOrigins: new Set([LOCAL_ORIGIN])`. Cmd-Z / Cmd-Shift-Z. Undo
    captures grouped by 200ms.
  - `useConnectivity` schedules debounced recompute (250ms) on every
    LOCAL_ORIGIN doc update. Currently a no-op because the wire shape
    of `/api/parts/catalog` doesn't include connection-point coords —
    see "Known limitations" below.
  - `useEditorStore` (Zustand) holds tool / selection / activeLayerId /
    placePartKey / zoom / pan.
- **Konva canvas**:
  - `GridLayer` — major + sub grid lines, background fill, ColorSpec
    converted via a small known-color table (BlueBrick names like
    `CornflowerBlue` mapped to hex).
  - `BrickLayer` — Konva.Image per brick using a sprite cache that
    loads from `/parts/<spritePath>`. Magenta placeholder during load.
    Selection outline (dashed blue) when selected.
- **Server**:
  - `GET/PUT /api/layouts/:id/snapshot` (binary octet-stream Y.Doc).
    PUT does access check (404 for non-collaborators, 403 for
    insufficient role) and bumps `docVersion`.
  - Same existence-leak fix applied to PATCH and DELETE.
- **Tools**:
  - Select (click brick to toggle, shift-click to add)
  - Place (click stage when a part is picked; brick spawned at cursor)
  - Drag (Konva native draggable)
  - Rotate (Q/E for ±15° on selection — integer-snapped)
  - Delete (Del/Backspace)
- **Parts panel** — catalog grouped by sortingKey, per-bucket cap of 50,
  thumbnail per part using `/parts/<spritePath>`.
- Layouts list page now has an "Open" button that links to `/editor/:id`.

**Test totals: 116 passing (46 bbm + 19 parts-catalog + 4 ydoc + 10 web + 37 server)**

## Known limitations to address in milestone 3 (polish)

1. **Connectivity recompute is plumbed but not active.** The wire shape
   of `/api/parts/catalog` strips connection-point coordinates. Either
   add `connections: ConnectionPoint[]` to `PartWire`, or add a separate
   `/api/parts/:key/connections` endpoint.

2. **Brick sizing on Place uses a hardcoded 16x16 stud default.** Should
   derive from sprite natural size / `pxPerStud`.

3. **No marquee-select.** Click-to-toggle works but no rubber-band.

4. **No multi-select drag.** Dragging one brick of a multi-selection
   only moves that brick.

5. **`PartsPanel` 50-per-bucket cap.** Large buckets are unscrollable
   beyond 50; needs virtualization or "load more".

6. **No place-tool ghost preview.**

7. **No copy/paste, no group/ungroup, no layer panel.** Deferred per
   PLAN.md Phase 3 scope.

## How to resume

1. `git status` should be clean (after this commit).
2. `pnpm -r typecheck && pnpm -r test && pnpm -r build` — all green.
3. `cd apps/server && pnpm dev` and `cd apps/web && pnpm dev` — Vite
   proxies /api and /ws to :3000. Visit http://localhost:5173.
4. Register a password account (set `ENABLE_PASSWORD_AUTH=true`),
   import `tight-corner.bbm` via the layouts list, click Open, edit.
5. **The connectivity hook is dormant** until item #1 in "Known
   limitations" lands. Brick `linkedTo` will stay empty after edits;
   that's expected.

## Next options

- Polish (items 1–6 above) — extends Phase 3 milestone 3, ~1 day
- Phase 4 (realtime collab) — y-websocket server, awareness, presence
  panel, snapshot worker. Replaces the snapshot REST endpoint with a
  WS provider. ~1.5 weeks per PLAN.md.
- Phase 5 (sharing + invites) — layout-collaborator UI, email/link
  invite flow, role-based access in REST + WS. ~1.5 weeks.
