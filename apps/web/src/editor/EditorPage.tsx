import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stage, Layer as KonvaLayer } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { api, type PartWire } from '../api';
import { useLayoutDoc } from './useLayoutDoc';
import { useYjsSnapshot } from './useYjsSnapshot';
import { useEditorStore } from './editorStore';
import { Toolbar } from './Toolbar';
import { GridLayer } from './render/GridLayer';
import { BrickLayer } from './render/BrickLayer';
import { PartsPanel } from './PartsPanel';
import { useViewportSize } from './useViewportSize';
import { docToBbm } from '@cld/ydoc';
import { deleteBricks, ensureBrickLayer, placeBrick, rotateBricks } from './mutations';
import { pxToStud, studToPx } from './render/coords';
import { ensureSprite } from './render/spriteCache';
import { PlaceGhost } from './render/PlaceGhost';
import { MarqueeOverlay, bricksInMarquee } from './render/MarqueeOverlay';
import { useUndoManager } from './useUndoManager';
import { useConnectivity } from './useConnectivity';
import { usePublishAwareness, dispatchCursorMove, dispatchCursorLeave } from './useAwareness';
import { PresencePanel } from './PresencePanel';
import { RemoteCursors } from './render/RemoteCursors';
import { ShareDialog } from '../layouts/ShareDialog';

export function EditorPage() {
  const params = useParams<{ id: string }>();
  if (!params.id) return <Navigate to="/" replace />;

  return <Editor layoutId={params.id} />;
}

function Editor({ layoutId }: { layoutId: string }) {
  const { doc, awareness, loadError, loading, status, saveNow } = useLayoutDoc(layoutId);
  const meta = useQuery({
    queryKey: ['layout', layoutId],
    queryFn: () => api.layouts.get(layoutId),
  });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const undo = useUndoManager(doc);
  const role = meta.data?.role ?? 'viewer';
  // Mobile viewport forces read-only mode regardless of role (PLAN.md
  // §1 non-goal: no touch editing on phones). We re-use the existing
  // viewer-mode UI gating instead of inventing a new "mobile" mode.
  const viewport = useViewportSize();
  const isViewer = role === 'viewer' || viewport.isMobile;
  const [showShare, setShowShare] = useState(false);

  // Publish our awareness state (cursor / selection / tool / identity).
  usePublishAwareness({ awareness, me: me.data?.user ?? null, layoutId });

  // Connectivity recompute (debounced). The hook listens to LOCAL_ORIGIN
  // updates and patches `linkedTo` fields back into Yjs. It's a no-op
  // until the parts-catalog wire shape carries connection-point data —
  // see SESSION_NOTES.md.
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });
  useConnectivity(doc, catalog.data?.parts);

  // Subscribe to ALL doc changes so the canvas re-renders.
  useYjsSnapshot(doc);

  // The active layer defaults to the first brick layer in the doc, if any.
  // Without an active layer the place tool has nowhere to put bricks.
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  useEffect(() => {
    if (!doc || activeLayerId) return;
    try {
      const map = docToBbm(doc);
      const firstBrick = map.layers.find((l) => l.type === 'brick');
      if (firstBrick) setActiveLayer(firstBrick.id);
    } catch {
      // Doc isn't fully populated yet (e.g. blank-create layout). Phase 3
      // doesn't seed an empty doc with default layers; the editor shows
      // an empty-state hint and the user must import a `.bbm`.
    }
  }, [doc, activeLayerId, setActiveLayer]);

  if (loadError) return <ErrorScreen err={loadError} />;
  if (loading || !doc) return <LoadingScreen />;

  return (
    <div
      className={
        // Mobile: no sidebar column. Desktop: 260px parts panel + canvas.
        // The viewport drives `isViewer` too, so the conditional renders
        // below already skip mounting the panel; this just collapses
        // the grid.
        viewport.isMobile
          ? 'grid h-screen grid-cols-[1fr] grid-rows-[auto_1fr] bg-neutral-950'
          : 'grid h-screen grid-cols-[260px_1fr] grid-rows-[auto_1fr] bg-neutral-950'
      }
    >
      <header
        className={
          // Span the entire grid width — 1 column on mobile, 2 on desktop.
          (viewport.isMobile ? 'col-span-1' : 'col-span-2') +
          ' flex items-center justify-between border-b border-neutral-800 px-4 py-2'
        }
      >
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-neutral-400 hover:underline">
            ← Layouts
          </Link>
          <h1 className="text-sm font-semibold">
            {meta.data?.layout.title ?? 'Untitled'}
          </h1>
          <SaveStatusIndicator status={status} />
          <PresencePanel awareness={awareness} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={undo.undo}
            disabled={!undo.canUndo}
            title="Undo (Cmd-Z)"
            className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={undo.redo}
            disabled={!undo.canRedo}
            title="Redo (Cmd-Shift-Z)"
            className="rounded border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
          >
            Redo
          </button>
          {!isViewer && <Toolbar />}
          <button
            onClick={() => setShowShare(true)}
            className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Share
          </button>
          {!isViewer && (
            <button
              onClick={() => void saveNow()}
              className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
            >
              Save
            </button>
          )}
          {isViewer && (
            <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">
              View only
            </span>
          )}
        </div>
      </header>
      {!isViewer && <PartsPanel />}
      {isViewer && <div className="row-start-2 row-end-3" />}
      <main className="relative overflow-hidden">
        <Canvas doc={doc} awareness={awareness} isViewer={isViewer} />
      </main>
      {showShare && me.data?.user && meta.data && (
        <ShareDialog
          layoutId={layoutId}
          layoutTitle={meta.data.layout.title}
          myRole={role}
          myUserId={me.data.user.id}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}

function Canvas({
  doc,
  awareness,
  isViewer,
}: {
  doc: import('yjs').Doc;
  awareness: import('y-protocols/awareness').Awareness | null;
  isViewer: boolean;
}) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const { width, height } = useViewportSize();
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const tool = useEditorStore((s) => s.tool);
  const placePartKey = useEditorStore((s) => s.placePartKey);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);

  // Cursor in world studs — drives the Place ghost preview. We refresh
  // it on mousemove only when relevant (place tool active) to avoid
  // re-rendering the whole canvas on every pixel of mouse movement.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Marquee state. Active while the user is dragging in select mode on
  // empty stage. Mouse-up commits the intersection to selection.
  const [marquee, setMarquee] = useState<import('./render/MarqueeOverlay').Marquee | null>(null);

  // Reconstruct the BbmMap on every render to feed the layer renderers.
  // Cheap because we already re-rendered on Yjs change; the projection is
  // pure JS over Y.Maps. Real layouts (~500 bricks) are <1ms to project.
  const rev = useYjsSnapshot(doc);
  const map = useMemo(() => {
    try {
      return docToBbm(doc);
    } catch {
      return null;
    }
  }, [doc, rev]);

  // Index parts by key for fast place-tool lookup.
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });
  const partsByKey = useMemo(() => {
    const m = new Map<string, PartWire>();
    for (const p of catalog.data?.parts ?? []) m.set(p.key, p);
    return m;
  }, [catalog.data]);

  // Q / E rotate selection by ±15°. Delete / Backspace remove selection.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isViewer) return; // viewers can't rotate/delete
      if (selection.length === 0 || !activeLayerId) return;
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        rotateBricks(doc, activeLayerId, selection, -15);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        rotateBricks(doc, activeLayerId, selection, 15);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteBricks(doc, activeLayerId, selection);
        setSelection([]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selection, activeLayerId, setSelection, isViewer]);

  /** Read the pointer's stud-space coordinates. */
  function pointerStuds(): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const ptr = stage.getPointerPosition();
    if (!ptr) return null;
    return {
      x: pxToStud((ptr.x - panX) / zoom),
      y: pxToStud((ptr.y - panY) / zoom),
    };
  }

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    if (e.target !== e.target.getStage()) return;
    const studs = pointerStuds();
    if (!studs) return;

    if (tool === 'select') {
      // Empty-space click in select mode → start marquee.
      setSelection([]);
      setMarquee({ x0: studs.x, y0: studs.y, x1: studs.x, y1: studs.y });
      return;
    }
    if (tool === 'place' && placePartKey) {
      if (isViewer) return; // viewers can't place bricks
      void doPlace(studs.x, studs.y);
    }
  }

  function handleStageMouseMove(_e: KonvaEventObject<MouseEvent>) {
    const studs = pointerStuds();
    if (!studs) return;
    if (tool === 'place') setCursor(studs);
    if (marquee) setMarquee({ ...marquee, x1: studs.x, y1: studs.y });
    // Always broadcast cursor so peers can see us — even when we're
    // panning or hovering empty space.
    dispatchCursorMove(studs.x, studs.y);
  }

  function handleStageMouseLeave() {
    dispatchCursorLeave();
  }

  function handleStageMouseUp(_e: KonvaEventObject<MouseEvent>) {
    if (!marquee) return;
    // Commit selection. Only the FIRST brick layer is queryable here —
    // multi-layer marquee would need an active-layer scope (or a global
    // "all visible bricks" scope). Sticking with active-layer for now.
    const layer = map?.layers.find(
      (l) => l.id === activeLayerId && l.type === 'brick',
    );
    if (layer && layer.type === 'brick') {
      const ids = bricksInMarquee(marquee, layer.bricks).map((id) => id);
      setSelection(ids);
    }
    setMarquee(null);
  }

  async function doPlace(studX: number, studY: number) {
    const meta = partsByKey.get(placePartKey);
    if (!meta) return;

    // Sprite-aware sizing. Load the GIF/PNG (cached), then derive stud
    // size as `naturalSize / pxPerStud` — matches the desktop's
    // SceneBuilder. Fall back to 16x16 studs if the sprite is missing
    // (rare; usually means the part XML lists no spritePath).
    let widthStuds = 16;
    let heightStuds = 16;
    if (meta.spritePath) {
      try {
        const img = await ensureSprite(`/parts/${meta.spritePath}`);
        widthStuds = img.naturalWidth / meta.pxPerStud;
        heightStuds = img.naturalHeight / meta.pxPerStud;
      } catch {
        // Use the default; the brick still places, just sized 16x16.
      }
    }

    const layerId = activeLayerId ?? ensureBrickLayer(doc);
    if (!activeLayerId) setActiveLayer(layerId);

    placeBrick(doc, layerId, {
      partNumber: meta.partNumber,
      x: studX - widthStuds / 2,
      y: studY - heightStuds / 2,
      width: widthStuds,
      height: heightStuds,
    });
  }

  if (!map) return <EmptyDoc />;
  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={panX}
      y={panY}
      scaleX={zoom}
      scaleY={zoom}
      // Disable Konva's stage-level drag while marquee or place is in
      // play; otherwise the user's intended select/place gesture turns
      // into a pan.
      draggable={tool !== 'place' && tool !== 'select'}
      onDragEnd={(e) => {
        useEditorStore.getState().setPan(e.target.x(), e.target.y());
      }}
      onWheel={(e) => {
        e.evt.preventDefault();
        const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
        useEditorStore.getState().setZoom(zoom * factor);
      }}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onMouseLeave={handleStageMouseLeave}
      onTouchStart={handleStageMouseDown as unknown as (e: KonvaEventObject<TouchEvent>) => void}
    >
      <KonvaLayer listening={false}>
        <GridLayer map={map} />
      </KonvaLayer>
      <KonvaLayer>
        <BrickLayer map={map} doc={doc} isViewer={isViewer} />
      </KonvaLayer>
      <KonvaLayer listening={false}>
        {tool === 'place' && cursor && (
          <PlaceGhost
            part={partsByKey.get(placePartKey) ?? null}
            cursorStudX={cursor.x}
            cursorStudY={cursor.y}
          />
        )}
        <MarqueeOverlay marquee={marquee} />
        <RemoteCursors awareness={awareness} map={map} />
      </KonvaLayer>
    </Stage>
  );
}

function SaveStatusIndicator({ status }: { status: import('./useLayoutDoc').SaveStatus }) {
  switch (status.kind) {
    case 'connecting':
      return <span className="text-xs text-neutral-500">connecting…</span>;
    case 'synced':
      return <span className="text-xs text-emerald-500">synced</span>;
    case 'reconnecting':
      return (
        <span className="text-xs text-amber-400">
          reconnecting{status.lastSyncedAt ? ` · last synced ${timeAgo(status.lastSyncedAt)}` : ''}
        </span>
      );
    case 'offline':
      return (
        <span className="text-xs text-amber-400">
          offline{status.lastSyncedAt ? ` · edits saved locally, will sync on reconnect` : ''}
        </span>
      );
    case 'error':
      return <span className="text-xs text-red-400">{status.message}</span>;
  }
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  return `${Math.round(secs / 60)}m ago`;
}

function LoadingScreen() {
  return <div className="grid h-screen place-items-center text-neutral-500">Loading editor…</div>;
}

function ErrorScreen({ err }: { err: Error }) {
  return (
    <div className="grid h-screen place-items-center">
      <div className="max-w-sm rounded border border-red-900 bg-red-950/30 p-4 text-sm">
        <p className="font-semibold text-red-400">Couldn't load this layout.</p>
        <p className="mt-2 text-neutral-300">{err.message}</p>
        <Link to="/" className="mt-4 inline-block text-blue-400 hover:underline">
          ← back to layouts
        </Link>
      </div>
    </div>
  );
}

function EmptyDoc() {
  return (
    <div className="absolute inset-0 grid place-items-center text-neutral-500">
      <div className="text-center">
        <p>This layout has no map data yet.</p>
        <p className="text-sm">Import a <code>.bbm</code> from the layouts list to populate it.</p>
      </div>
    </div>
  );
}
