import { useEffect, useMemo, useRef } from 'react';
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
import { useUndoManager } from './useUndoManager';
import { useConnectivity } from './useConnectivity';

export function EditorPage() {
  const params = useParams<{ id: string }>();
  if (!params.id) return <Navigate to="/" replace />;

  return <Editor layoutId={params.id} />;
}

function Editor({ layoutId }: { layoutId: string }) {
  const { doc, loadError, loading, status, saveNow } = useLayoutDoc(layoutId);
  const meta = useQuery({
    queryKey: ['layout', layoutId],
    queryFn: () => api.layouts.get(layoutId),
  });
  const undo = useUndoManager(doc);

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
    <div className="grid h-screen grid-cols-[260px_1fr] grid-rows-[auto_1fr] bg-neutral-950">
      <header className="col-span-2 flex items-center justify-between border-b border-neutral-800 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-neutral-400 hover:underline">
            ← Layouts
          </Link>
          <h1 className="text-sm font-semibold">
            {meta.data?.layout.title ?? 'Untitled'}
          </h1>
          <SaveStatusIndicator status={status} />
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
          <Toolbar />
          <button
            onClick={() => void saveNow()}
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
          >
            Save
          </button>
        </div>
      </header>
      <PartsPanel />
      <main className="relative overflow-hidden">
        <Canvas doc={doc} />
      </main>
    </div>
  );
}

function Canvas({ doc }: { doc: import('yjs').Doc }) {
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
  }, [doc, selection, activeLayerId, setSelection]);

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    // Click on empty space → clear selection (when in select tool).
    if (tool === 'select' && e.target === e.target.getStage()) {
      setSelection([]);
      return;
    }
    if (tool !== 'place' || !placePartKey || e.target !== e.target.getStage()) return;
    const stage = stageRef.current;
    if (!stage) return;
    const ptr = stage.getPointerPosition();
    if (!ptr) return;
    // Convert pointer (px) → world studs.
    const worldX = (ptr.x - panX) / zoom;
    const worldY = (ptr.y - panY) / zoom;
    const studX = pxToStud(worldX);
    const studY = pxToStud(worldY);

    const meta = partsByKey.get(placePartKey);
    if (!meta) return;
    // Default brick size when the catalog doesn't tell us — small placeholder.
    // The desktop derives this from the sprite dimensions; sprite-aware
    // sizing arrives later. Use 16x16 studs as a sensible default until
    // we read the sprite's natural size.
    const sizeStuds = 16;

    const layerId = activeLayerId ?? ensureBrickLayer(doc);
    if (!activeLayerId) setActiveLayer(layerId);

    placeBrick(doc, layerId, {
      partNumber: meta.partNumber,
      x: studX - sizeStuds / 2,
      y: studY - sizeStuds / 2,
      width: sizeStuds,
      height: sizeStuds,
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
      draggable={tool !== 'place'}
      onDragEnd={(e) => {
        useEditorStore.getState().setPan(e.target.x(), e.target.y());
      }}
      onWheel={(e) => {
        e.evt.preventDefault();
        const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
        useEditorStore.getState().setZoom(zoom * factor);
      }}
      onMouseDown={handleStageMouseDown}
      onTouchStart={handleStageMouseDown as unknown as (e: KonvaEventObject<TouchEvent>) => void}
    >
      <KonvaLayer listening={false}>
        <GridLayer map={map} />
      </KonvaLayer>
      <KonvaLayer>
        <BrickLayer map={map} doc={doc} />
      </KonvaLayer>
    </Stage>
  );
}

function SaveStatusIndicator({ status }: { status: import('./useLayoutDoc').SaveStatus }) {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'dirty':
      return <span className="text-xs text-neutral-500">unsaved changes…</span>;
    case 'saving':
      return <span className="text-xs text-neutral-500">saving…</span>;
    case 'saved':
      return (
        <span className="text-xs text-emerald-500">
          saved {timeAgo(status.at)}
        </span>
      );
    case 'error':
      return <span className="text-xs text-red-400">save failed: {status.message}</span>;
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
