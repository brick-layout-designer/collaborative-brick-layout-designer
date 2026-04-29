# Session notes — Phase 3 complete (milestones 1, 2, 3)

> Living document. Move into PLAN.md / commit messages once it's no
> longer needed.

## Commits

- **`4de0b70`** — initial scaffold (Phases 1, 2, Phase 3 milestone 1).
  Monorepo + auth + layouts + .bbm parser + parts catalog +
  connectivity recompute. 98 tests.
- **`2b30dad`** — Phase 3 milestone 2: editor scaffold, Yjs projection,
  snapshot REST, tools, undo/redo. 116 tests.
- *(this commit)* — Phase 3 milestone 3: connectivity activated,
  marquee, ghost preview, multi-drag, sprite-aware sizing. 122 tests.

## Phase 3 milestone 3 (this session)

**Connectivity activated:**
- `/api/parts/catalog` wire shape now ships full `connections[]` per part
  (type, x, y, angle, electricPlug). `hasConnections: boolean` removed.
- `useConnectivity` builds a real `Catalog` from the wire data and
  feeds it to `rebuildConnectivity`. Debounced 250ms after each
  LOCAL_ORIGIN edit.
- `linkedTo` writeback wraps in `doc.transact(..., LOCAL_ORIGIN)` so
  the connectivity update folds into the same undo step as the
  triggering brick edit.

**Sprite-aware sizing:**
- Place tool now `await ensureSprite(...)`, reads
  `naturalWidth/Height`, divides by `pxPerStud` for stud size. Falls
  back to 16x16 if the sprite is missing.

**Place-tool ghost preview:**
- `PlaceGhost` component: faded Konva.Image at cursor, sized
  identically to the brick that will be created.
- Cursor tracked via stage `onMouseMove`, in stud coordinates.

**Marquee select:**
- Drag on empty stage in select mode draws a rubber-band rectangle.
- `bricksInMarquee` (in pure `marqueeMath.ts`) does AABB intersection.
  Inverted drags (bottom-right → top-left) work.
- Selection commits on mouse up.

**Multi-select drag:**
- `translateBricks` mutation: shifts every brick in a list by the same
  delta in a single Yjs transaction (one undo step).
- BrickLayer's drag handler dispatches based on `selection.length`:
  single brick → `moveBrick`, multi → `translateBricks`.

**Parts panel polish:**
- Removed 50-per-bucket cap (browser handles 500+ lazy-loaded `<img>`).
- Buckets collapsed by default; expanded automatically when search
  filter is non-empty.

**Refactors:**
- Mutation helpers (`deleteBricks`, `moveBrick`, `translateBricks`)
  centralised in `mutations.ts`. BrickLayer no longer has its own
  duplicate copies.
- `marqueeMath.ts` split off from `MarqueeOverlay.tsx` so unit tests
  can run without react-konva (which needs a DOM canvas in Node).

## Test totals (last run)

- 46 bbm
- 19 parts-catalog
- 4 ydoc
- 16 web (10 mutations + 4 marquee + 2 file passes)
- 37 server
- = **122 passing**

## How to resume

1. `git status` should be clean after this commit.
2. `pnpm -r typecheck && pnpm -r test && pnpm -r build` — all green.
3. `cd apps/server && pnpm dev` (port 3000) and `cd apps/web && pnpm dev`
   (port 5173 with proxy).
4. Set `ENABLE_PASSWORD_AUTH=true` in `apps/server/.env`, register, import
   `tight-corner.bbm` from `packages/bbm/tests/fixtures/`, click Open.
5. Try: place a part (search "TS_CURVE" in parts panel, click, then
   click on canvas), drag it, Q/E to rotate, Cmd-Z to undo, marquee-
   select a group, drag the group, Del to delete.

## Phase 3 deferred items (PLAN.md notes)

- Layer panel (add / hide / reorder layers)
- Copy/paste, group/ungroup
- Place-time snap-to-connection-point hint
- Connection-point markers visualisation

## What's next

Phase 4 — Realtime collab + presence (~1.5 weeks per PLAN.md):
- y-websocket server in-process with Fastify
- Yjs doc hydration from snapshot + replay; idle eviction
- Snapshot worker: every 30s of activity, rewrite snapshot + truncate updates
- Awareness: cursors, selection outlines, presence panel
- Connection-state UI (reconnecting, offline)
- Replace the snapshot-REST `useLayoutDoc` with a y-websocket provider
- Multiplayer test: 2 tabs editing the same map → mutual cursors,
  edits flow both ways, offline-then-reconnect merges cleanly

The Phase-3 editor's mutations are already well-structured for this:
every change goes through `LOCAL_ORIGIN`-tagged transactions, so the
WS layer just needs to broadcast them.
