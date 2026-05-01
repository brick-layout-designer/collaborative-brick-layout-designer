// Anonymous read-only viewer for layouts the owner has marked public via
// the share dialog (`Public link → Enable`). Loads the snapshot bytes via
// the unauthenticated `/api/public-layouts/:token/snapshot` endpoint,
// hydrates a Y.Doc, and renders with the existing layer components in
// `isViewer` mode. No WebSocket, no live edits — re-fetching the page
// pulls a fresh snapshot if the owner has saved since.
//
// Pan with middle-button drag (Konva.dragButtons = [0] is set globally,
// so middle-click pan is left to our handler). Zoom with wheel. No
// selection, no tools, no parts panel.

import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stage, Layer as KonvaLayer } from 'react-konva';
import * as Y from 'yjs';
import type Konva from 'konva';
import { decodeDoc, docToBbm } from '@cld/ydoc';
import { api } from '../api';
import { useViewportSize } from '../editor/useViewportSize';
import { GridLayer } from '../editor/render/GridLayer';
import { BrickLayer } from '../editor/render/BrickLayer';
import { AreaLayers } from '../editor/render/AreaLayer';
import { TextLayers } from '../editor/render/TextLayer';
import { RulerLayers } from '../editor/render/RulerLayer';
import { studToPx, pxToStud } from '../editor/render/coords';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

export function PublicLayoutPage() {
  const params = useParams<{ token: string }>();
  if (!params.token) return <Navigate to="/" replace />;
  return <Viewer token={params.token} />;
}

function Viewer({ token }: { token: string }) {
  const meta = useQuery({
    queryKey: ['public-layout', token],
    queryFn: () => api.publicLayouts.get(token),
    retry: false,
  });
  const snapshot = useQuery({
    queryKey: ['public-layout-snapshot', token],
    queryFn: () => api.publicLayouts.snapshot(token),
    retry: false,
  });

  // Decode the snapshot into a one-shot Y.Doc once the bytes arrive. We
  // don't subscribe to updates — the public viewer is static for the
  // lifetime of the page load.
  const doc = useMemo<Y.Doc | null>(() => {
    if (!snapshot.data) return null;
    try {
      return decodeDoc(snapshot.data.bytes);
    } catch {
      return null;
    }
  }, [snapshot.data]);

  if (meta.error || snapshot.error) {
    return (
      <div className="grid min-h-screen place-items-center p-8 text-center">
        <div>
          <h1 className="text-xl font-semibold">Layout not found</h1>
          <p className="mt-2 text-sm text-neutral-500">
            This share link is invalid or has been disabled by the owner.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-blue-400 hover:underline"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!meta.data || !doc) {
    return (
      <div className="grid min-h-screen place-items-center text-neutral-500">
        Loading…
      </div>
    );
  }

  return <ViewerCanvas doc={doc} title={meta.data.layout.title} />;
}

function ViewerCanvas({ doc, title }: { doc: Y.Doc; title: string }) {
  const { width, height } = useViewportSize();
  // Dedicated local pan/zoom state — we don't share `useEditorStore` here
  // because that store has tools / selection / mutations the public viewer
  // shouldn't touch.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const stageRef = useRef<Konva.Stage | null>(null);

  // Project the Y.Doc into a BbmMap once. Snapshot is static for this
  // page so a single projection is enough; if the owner edits while the
  // viewer is open, a manual refresh re-fetches.
  const map = useMemo(() => {
    try {
      return docToBbm(doc);
    } catch {
      return null;
    }
  }, [doc]);

  // Centre the stage on the bricks' bounding box on first render — same
  // first-paint centering the editor does, so the viewer doesn't dump
  // people at (0,0) of a layout drawn at e.g. (3000, 1500).
  useEffect(() => {
    if (!map) return;
    const bb = bricksBBox(map);
    if (!bb) return;
    const cxStud = (bb.minX + bb.maxX) / 2;
    const cyStud = (bb.minY + bb.maxY) / 2;
    setPan({
      x: width / 2 - cxStud * studToPx() * zoom,
      y: height / 2 - cyStud * studToPx() * zoom,
    });
    // Only run once when the map first arrives; subsequent zoom changes
    // shouldn't recentre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map !== null]);

  if (!map) {
    return (
      <div className="grid min-h-screen place-items-center text-neutral-500">
        Failed to render layout.
      </div>
    );
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>) {
    e.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const ptr = stage.getPointerPosition();
    if (!ptr) return;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    // Zoom around the pointer so the world point under the cursor stays
    // put — same trick the editor uses.
    const worldX = (ptr.x - pan.x) / zoom;
    const worldY = (ptr.y - pan.y) / zoom;
    setPan({
      x: ptr.x - worldX * newZoom,
      y: ptr.y - worldY * newZoom,
    });
    setZoom(newZoom);
  }

  // Compute the visible-world rect for GridLayer.
  const viewport = {
    studXMin: pxToStud(-pan.x / zoom),
    studYMin: pxToStud(-pan.y / zoom),
    studXMax: pxToStud((width - pan.x) / zoom),
    studYMax: pxToStud((height - pan.y) / zoom),
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-neutral-900">
      {/* Banner — minimal, dismissable-feeling but kept up so the user
          knows they're on a public link. */}
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs">
        <span className="text-neutral-300">{title}</span>
        <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-blue-300">
          Public · view only
        </span>
        <Link to="/" className="ml-2 text-neutral-400 hover:underline">
          CLD
        </Link>
      </div>

      <div onWheel={handleWheel}>
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          x={pan.x}
          y={pan.y}
          scaleX={zoom}
          scaleY={zoom}
          draggable
          onDragEnd={(e) => {
            // Stage drag becomes pan. Konva resets stage x/y on dragstart
            // by default for `draggable`; we just commit them to state.
            setPan({ x: e.target.x(), y: e.target.y() });
          }}
        >
          <KonvaLayer listening={false}>
            <GridLayer map={map} viewport={viewport} showGrid={true} />
            <AreaLayers map={map} />
            <BrickLayer map={map} doc={doc} isViewer />
            <TextLayers map={map} />
            <RulerLayers map={map} />
          </KonvaLayer>
        </Stage>
      </div>
    </div>
  );
}

function bricksBBox(
  map: ReturnType<typeof docToBbm>,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      any = true;
      minX = Math.min(minX, b.displayArea.x);
      minY = Math.min(minY, b.displayArea.y);
      maxX = Math.max(maxX, b.displayArea.x + b.displayArea.width);
      maxY = Math.max(maxY, b.displayArea.y + b.displayArea.height);
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}
