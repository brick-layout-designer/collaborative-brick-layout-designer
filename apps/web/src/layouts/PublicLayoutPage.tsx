// Anonymous read-only viewer for layouts the owner has marked public via
// the share dialog (`Public link → Enable`). Loads the snapshot bytes via
// the unauthenticated `/api/public-layouts/:token/snapshot` endpoint,
// hydrates a Y.Doc, and renders with the existing layer components in
// `isViewer` mode. No WebSocket, no live edits — re-fetching the page
// pulls a fresh snapshot if the owner has saved since.
//
// Pan by dragging (mouse) or with one finger; zoom with the wheel, a
// pinch, or the -, + and Fit buttons. No selection, no tools, no parts
// panel.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stage, Layer as KonvaLayer } from 'react-konva';
import * as Y from 'yjs';
import type Konva from 'konva';
import { decodeDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import { api } from '../api';
import '../konvaSetup';
import type { LayerGrid } from '@cld/model';
import { useViewportSize } from '../editor/useViewportSize';
import { useElementSize } from '../editor/useElementSize';
import { useTouchView } from '../editor/useTouchView';
import type { View } from '../editor/touchGesture';
import { fitView, isUntouchedFit, withGridLabels, type ViewInsets } from '../editor/viewFit';
import { contentBoundsStuds, type StudRect } from '../editor/exportRender';
import { drawnGridLayer } from '../editor/render/gridIndex';
import { MIN_ZOOM, MAX_ZOOM, useEditorStore } from '../editor/editorStore';
import { PHONE_MIN_TEXT_PX } from '../editor/textLegibility';
import { GridLayer } from '../editor/render/GridLayer';
import { BrickLayer } from '../editor/render/BrickLayer';
import { AreaLayers } from '../editor/render/AreaLayer';
import { TextLayers } from '../editor/render/TextLayer';
import { RulerLayers } from '../editor/render/RulerLayer';
import { pxToStud } from '../editor/render/coords';
import { VenueOverlay } from '../editor/render/VenueOverlay';
import { AnchoredLabels } from '../editor/render/AnchoredLabels';
import { ModuleOverlay } from '../editor/render/ModuleOverlay';
import { applyViewSheets, viewRegionStuds } from '../editor/savedViews';

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
          <p className="mt-2 text-sm text-muted">
            This share link is invalid or has been disabled by the owner.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-accent-text hover:underline"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!meta.data || !doc) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
        Loading…
      </div>
    );
  }

  return (
    <LayoutViewer
      doc={doc}
      title={meta.data.layout.title}
      // Somewhere to go from a shared link: the app (its sign-in page, with
      // the demo and the catalog, for a visitor).
      topRight={
        <Link to="/" title="Brick Layout Designer" className="rounded-lg border border-border bg-panel/95 px-3 py-1.5 text-sm shadow hover:bg-soft">
          Home
        </Link>
      }
    />
  );
}

/**
 * The read-only layout viewer: the editor's own renderer (parts, text,
 * rulers, areas, the venue, module outlines and names, anchored labels),
 * pan and zoom, and the layout's saved views. Used by public share links
 * and by the catalog's layout pages (`badge`, and `side` for the panel).
 */
export function LayoutViewer({
  doc,
  title,
  badge = 'Public · view only',
  side,
  topRight,
  fitBounds,
}: {
  doc: Y.Doc;
  title: string;
  badge?: string;
  side?: ReactNode;
  topRight?: ReactNode;
  /** What "Fit" shows when not the drawn content (a venue's floor). */
  fitBounds?: StudRect | null;
}) {
  // The real size of the canvas box (dvh-sized, so the browser bars on a
  // phone are taken into account), not the window's.
  const [boxRef, { width, height }, box] = useElementSize({ width: 0, height: 0 });
  // (0 until measured: nothing is fitted to a guessed size.)
  const { isMobile } = useViewportSize();
  // Dedicated local pan/zoom state — we don't share `useEditorStore` here
  // because that store has tools / selection / mutations the public viewer
  // shouldn't touch.
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
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
  const sidecar = useMemo(() => readSidecarFromDoc(doc), [doc]);
  const views = sidecar?.views ?? [];
  const [viewId, setViewId] = useState('');
  const activeView = views.find((v) => v.id === viewId) ?? null;
  const shown = useMemo(() => (map && activeView ? applyViewSheets(map, activeView.sheets) : map), [map, activeView]);

  // The shared text renderers hide unreadable text from the editor
  // store's zoom and threshold (textLegibility.ts); mirror ours into it.
  // Nothing else of the store is used here.
  useEffect(() => {
    useEditorStore.setState({ zoom: view.zoom, minTextPx: isMobile ? PHONE_MIN_TEXT_PX : 0 });
  }, [view.zoom, isMobile]);
  useEffect(() => () => useEditorStore.setState({ minTextPx: 0 }), []);

  // Pan with one finger, pinch with two; the page itself never zooms.
  useTouchView(box, () => viewRef.current, setView, { oneFingerPan: true, range: ZOOM_RANGE });

  // Fit the whole layout, grid labels included, into the box. Fit again
  // when the box changes size (phone rotated, browser bars shown or
  // hidden) as long as the user hasn't moved the view since.
  const lastFitRef = useRef<View | null>(null);
  const fit = useCallback(() => {
    if (!map || width <= 0 || height <= 0) return;
    // A saved view shows its own area; otherwise everything.
    const region = activeView ? viewRegionStuds(activeView, map, sidecar) : null;
    const bounds = region ?? fitBounds ?? withGridLabels(contentBoundsStuds(map, null), drawnGridLayer(map.layers) as LayerGrid | undefined);
    const next = fitView(bounds, width, height, ZOOM_RANGE, isMobile ? PHONE_INSETS : DESKTOP_INSETS);
    if (!next) return;
    lastFitRef.current = next;
    setView(next);
  }, [map, width, height, isMobile, activeView, sidecar, fitBounds]);
  useEffect(() => {
    if (lastFitRef.current && !isUntouchedFit(viewRef.current, lastFitRef.current)) return;
    fit();
  }, [fit]);

  if (!map || !shown) {
    return (
      <div className="grid min-h-screen place-items-center text-muted">
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
    zoomAround(e.deltaY < 0 ? 1.1 : 1 / 1.1, ptr.x, ptr.y);
  }

  function zoomAround(factor: number, x: number, y: number) {
    setView((v) => {
      const zoom = Math.max(ZOOM_RANGE.min, Math.min(ZOOM_RANGE.max, v.zoom * factor));
      // Zoom around the point so the world point under it stays put —
      // same trick the editor uses.
      const worldX = (x - v.panX) / v.zoom;
      const worldY = (y - v.panY) / v.zoom;
      return { zoom, panX: x - worldX * zoom, panY: y - worldY * zoom };
    });
  }

  // Compute the visible-world rect for GridLayer.
  const viewport = {
    studXMin: pxToStud(-view.panX / view.zoom),
    studYMin: pxToStud(-view.panY / view.zoom),
    studXMax: pxToStud((width - view.panX) / view.zoom),
    studYMax: pxToStud((height - view.panY) / view.zoom),
  };
  const btn = 'flex h-11 min-w-11 items-center justify-center rounded-control border border-border bg-panel/95 px-3 text-base font-bold text-ink shadow';

  return (
    <div className="relative h-screen supports-[height:100dvh]:h-dvh w-full overflow-hidden bg-panel">
      {/* Banner — minimal, kept up so the user knows they're on a public link. */}
      <div
        className="absolute z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-panel/90 px-3 py-1.5 text-sm"
        style={{ left: 'max(0.75rem, env(safe-area-inset-left))', top: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <span className="min-w-0 truncate font-semibold text-ink">{title}</span>
        <span className="whitespace-nowrap rounded-lg bg-accent-soft px-1.5 py-0.5 text-xs text-accent-text">
          {badge}
        </span>
        {views.length > 0 && (
          <select
            value={viewId}
            onChange={(e) => {
              lastFitRef.current = null;
              setViewId(e.target.value);
            }}
            aria-label="Saved view"
            className="min-h-8 rounded-lg border border-border bg-soft px-2 text-xs"
          >
            <option value="">Whole layout</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div
        ref={boxRef}
        data-testid="canvas-area"
        className="absolute inset-0 touch-none overflow-hidden"
        onWheel={handleWheel}
      >
        <Stage
          ref={stageRef}
          width={width}
          height={height}
          x={view.panX}
          y={view.panY}
          scaleX={view.zoom}
          scaleY={view.zoom}
          draggable
          onDragStart={(e) => {
            // Touch pans through useTouchView; a Konva drag is for the mouse.
            if (e.evt && 'touches' in e.evt) e.target.stopDrag();
          }}
          onDragEnd={(e) => {
            // Stage drag becomes pan.
            if (e.target === e.target.getStage()) setView((v) => ({ ...v, panX: e.target.x(), panY: e.target.y() }));
          }}
        >
          <KonvaLayer listening={false}>
            <GridLayer map={map} viewport={viewport} showGrid={activeView ? activeView.grid : true} />
            <VenueOverlay venue={sidecar?.venue ?? null} />
            <AreaLayers map={shown} />
            <BrickLayer map={shown} doc={doc} isViewer />
            <TextLayers map={shown} />
            <RulerLayers map={shown} />
            {activeView && !activeView.labels ? null : (
              <AnchoredLabels map={map} labels={sidecar?.anchoredLabels ?? []} modules={sidecar?.modules ?? []} zoom={view.zoom} />
            )}
            <ModuleOverlay map={shown} modules={sidecar?.modules ?? []} />
          </KonvaLayer>
        </Stage>
      </div>

      {topRight && (
        <div className="absolute z-10 flex flex-wrap justify-end gap-1.5" style={{ right: 'max(0.75rem, env(safe-area-inset-right))', top: 'max(0.75rem, env(safe-area-inset-top))' }}>
          {topRight}
        </div>
      )}
      {side}
      <div
        className="absolute z-10 flex items-center gap-1.5"
        style={{ right: 'max(0.75rem, env(safe-area-inset-right))', bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoomAround(1 / 1.25, width / 2, height / 2)}>−</button>
        <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomAround(1.25, width / 2, height / 2)}>+</button>
        <button type="button" title="Fit everything in view" className={btn} onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

const ZOOM_RANGE = { min: MIN_ZOOM, max: MAX_ZOOM };
const DESKTOP_INSETS: ViewInsets = { top: 56, right: 16, bottom: 16, left: 16 };
const PHONE_INSETS: ViewInsets = { top: 64, right: 12, bottom: 68, left: 12 };
