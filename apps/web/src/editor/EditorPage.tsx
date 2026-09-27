import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stage, Layer as KonvaLayer, Circle, Group, Image as KonvaImage, Line, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { api, spriteUrlFor, type PartWire } from '../api';
import { useLayoutDoc } from './useLayoutDoc';
import { useDocMap, projectDoc } from './useDocMap';
import { useEditorStore, SNAP_STEPS, ROTATION_STEPS, MIN_ZOOM, MAX_ZOOM, type AnnoSelection } from './editorStore';
import {
  annoCount,
  annotationsInMarquee,
  clickAnno,
  deleteMixedSelection,
  mergeAnno,
  translateMixedSelection,
} from './mixedSelection';
import {
  annoNodeNames,
  collectNodes,
  restoreNodes,
  shiftNodes,
  type AnnoDragHandlers,
  type NodeSnap,
} from './render/groupDragNodes';
import { Toolbar } from './Toolbar';
import { GridLayer } from './render/GridLayer';
import { BrickLayer } from './render/BrickLayer';
import { PartsPanel } from './PartsPanel';
import { LayersPanel } from './LayersPanel';
import { PanelHost } from './PanelHost';
import { FloatingPanel } from './FloatingPanel';
import { Resizer } from './Resizer';
import { useDockLayout, type DockZone } from './dockLayout';
import { AreaLayers } from './render/AreaLayer';
import { TextLayers, type TextCellRef } from './render/TextLayer';
import { RulerLayers } from './render/RulerLayer';
import { AnchoredLabels } from './render/AnchoredLabels';
import { ElectricCircuitLayer } from './render/ElectricCircuitLayer';
import { ModuleOverlay } from './render/ModuleOverlay';
import { VenueOverlay } from './render/VenueOverlay';
import { readSidecarFromDoc } from '@cld/ydoc';
import { useViewportSize } from './useViewportSize';
import { localBbmDownload, sha256Hex } from '../bbmFiles';
import { backgroundImageRectPx } from './background';
import { validateVenue, venueAfterDraw, venueStatus, VENUE_MIN_POINTS_MESSAGE } from './venueValidator';
import { docToBbm } from '@cld/ydoc';
import {
  addCircularRuler,
  addLinearRuler,
  addTextCell,
  attachRulerEndpoint,
  deleteTextCell,
  editTextCellFull,
  moveRulerEndpoint,
  ensureAreaLayer,
  ensureBrickLayer,
  ensureRulerLayer,
  ensureTextLayer,
  allVisibleBrickIds,
  bricksByLayer,
  deleteBricksAcrossLayers,
  groupBricksAcrossLayers,
  importBricksAsModule,
  insertBricksAcrossLayers,
  insertBricks,
  paintAreaCells,
  placeBrick,
  readBudgetLimits,
  reorderBricks,
  setBudgetLimits,
  rotateBricksAboutCentroid,
  ungroupBricksAcrossLayers,
  setVenue,
  type ModuleBatch,
} from './mutations';
import { TextDialog, type TextDialogResult } from './TextDialog';
import { UsedPartsPanel } from './UsedPartsPanel';
import { readBricksFromClipboard, writeBricksToClipboard, type ClipboardEntry } from './clipboard';
import { pxToStud, studToPx } from './render/coords';
import { ensureSprite, getSpriteSync } from './render/spriteCache';
import { PlaceGhost } from './render/PlaceGhost';
import { ModuleGhost } from './render/ModuleGhost';
import { snapPlacement, snapToAnchorBrick, type AnchorSnapResult } from './snap';
import { MarqueeOverlay, bricksInMarquee } from './render/MarqueeOverlay';
import { useUndoManager } from './useUndoManager';
import { isEditableTarget } from './keyboardGuard';
import { useConnectivity } from './useConnectivity';
import { usePublishAwareness, dispatchCursorMove, dispatchCursorLeave } from './useAwareness';
import { PresencePanel } from './PresencePanel';
import { RemoteCursors } from './render/RemoteCursors';
import { MODULE_MIME, MODULE_NAME_MIME, activeModuleDrag } from './mime';
import { fetchModuleBatches } from './moduleSnapshot';
import { moduleDropTranslation } from './moduleDrop';
import { createModuleFromSelection } from './moduleActions';
import { EXPORT_HIDE, exportRegionStuds, exportSceneSize, renderMapToCanvas, watermarkText } from './exportRender';
import { dropdownAnchor, dropTargetHint, viewCentreStuds, wheelZoomStep } from './viewHelpers';
import { parseVenueFile, VENUE_FILE_ACCEPT, VENUE_FILE_EXT, writeVenueFile } from './venueFile';
import '../konvaSetup';
// Dialogs and infrequently-used panels — lazy-loaded so they don't bloat
// the initial editor chunk. React.lazy requires a default export, but all
// our components are named; the wrappers below re-export as default.
const ShareDialog = lazy(() => import('../layouts/ShareDialog').then((m) => ({ default: m.ShareDialog })));
const InsertModuleDialog = lazy(() => import('./InsertModuleDialog').then((m) => ({ default: m.InsertModuleDialog })));
const SaveModuleDialog = lazy(() => import('./SaveModuleDialog').then((m) => ({ default: m.SaveModuleDialog })));
const EditBrickDialog = lazy(() => import('./EditBrickDialog').then((m) => ({ default: m.EditBrickDialog })));
const EditRulerDialog = lazy(() => import('./EditRulerDialog').then((m) => ({ default: m.EditRulerDialog })));
const GeneralInfoDialog = lazy(() => import('./GeneralInfoDialog').then((m) => ({ default: m.GeneralInfoDialog })));
const BackgroundColorDialog = lazy(() => import('./BackgroundColorDialog').then((m) => ({ default: m.BackgroundColorDialog })));
const BackgroundImageDialog = lazy(() => import('./BackgroundImageDialog').then((m) => ({ default: m.BackgroundImageDialog })));
const FindDialog = lazy(() => import('./FindDialog').then((m) => ({ default: m.FindDialog })));
const PreferencesDialog = lazy(() => import('./PreferencesDialog').then((m) => ({ default: m.PreferencesDialog })));
const ImportBbmDialog = lazy(() => import('./ImportBbmDialog').then((m) => ({ default: m.ImportBbmDialog })));
const ExportImageDialog = lazy(() => import('./ExportImageDialog').then((m) => ({ default: m.ExportImageDialog })));
const AddAnchoredLabelDialog = lazy(() => import('./AddAnchoredLabelDialog').then((m) => ({ default: m.AddAnchoredLabelDialog })));
const SaveAsSetDialog = lazy(() => import('./SaveAsSetDialog').then((m) => ({ default: m.SaveAsSetDialog })));
const ModulesPanel = lazy(() => import('./ModulesPanel').then((m) => ({ default: m.ModulesPanel })));
const ModuleLibraryPanel = lazy(() => import('./ModuleLibraryPanel').then((m) => ({ default: m.ModuleLibraryPanel })));
const VenuePropertiesDialog = lazy(() => import('./VenuePropertiesDialog').then((m) => ({ default: m.VenuePropertiesDialog })));
const VenueDimensionsDialog = lazy(() => import('./VenueDimensionsDialog').then((m) => ({ default: m.VenueDimensionsDialog })));
const BudgetDialog = lazy(() => import('./BudgetDialog').then((m) => ({ default: m.BudgetDialog })));
const VenueLibraryPanel = lazy(() => import('./VenueLibraryPanel').then((m) => ({ default: m.VenueLibraryPanel })));
const VenueSaveLibraryDialog = lazy(() => import('./VenueSaveLibraryDialog').then((m) => ({ default: m.VenueSaveLibraryDialog })));

export function EditorPage() {
  const params = useParams<{ id: string }>();
  if (!params.id) return <Navigate to="/" replace />;

  return <Editor layoutId={params.id} />;
}

function Editor({ layoutId }: { layoutId: string }) {
  const { doc, awareness, loadError, loading, status, saveNow: checkSaved } = useLayoutDoc(layoutId);
  const meta = useQuery({
    queryKey: ['layout', layoutId],
    queryFn: () => api.layouts.get(layoutId),
  });
  // Save / Ctrl+S: every edit is already persisted server-side while the
  // socket is synced; when it isn't, offer the local state as a .bbm so
  // nothing is lost (desktop's Save always leaves a file on disk).
  const saveNow = useCallback(async (): Promise<void> => {
    if (!doc) return;
    const result = await checkSaved();
    if (result === 'saved') {
      useEditorStore.getState().showStatusMessage('All changes saved to the server', 3000);
      return;
    }
    if (window.confirm('Not connected to the server — your latest changes will sync when the connection returns.\n\nDownload a .bbm copy of the current local version now?')) {
      void downloadLocalBbm(doc, meta.data?.layout.title ?? 'layout');
    }
  }, [doc, checkSaved, meta.data?.layout.title]);
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const myOrgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const undo = useUndoManager(doc);
  const role = meta.data?.role ?? 'viewer';
  // Mobile viewport forces read-only mode regardless of role (PLAN.md
  // §1 non-goal: no touch editing on phones). We re-use the existing
  // viewer-mode UI gating instead of inventing a new "mobile" mode.
  const viewport = useViewportSize();
  const isViewer = role === 'viewer' || viewport.isMobile;
  const [showShare, setShowShare] = useState(false);
  const [showInsertModule, setShowInsertModule] = useState(false);
  const [showSaveModule, setShowSaveModule] = useState(false);
  const [showGeneralInfo, setShowGeneralInfo] = useState(false);
  const [showBackgroundColor, setShowBackgroundColor] = useState(false);
  const [showBackgroundImage, setShowBackgroundImage] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showExportImage, setShowExportImage] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [showImportBbm, setShowImportBbm] = useState(false);
  const [showAddLabel, setShowAddLabel] = useState(false);
  const [showSaveAsSet, setShowSaveAsSet] = useState(false);
  const [showVenueProps, setShowVenueProps] = useState(false);
  const [showVenueDimensions, setShowVenueDimensions] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [showVenueSaveLibrary, setShowVenueSaveLibrary] = useState(false);

  // Imperative handle so the PartsPanel can trigger click-to-place
  // without lifting all of placePartAt's state up to Editor. Canvas
  // writes the current implementation into this ref on every render.
  const placeAtCenterRef = useRef<((part: PartWire) => void) | null>(null);
  const onPlacePart = useCallback((part: PartWire) => {
    placeAtCenterRef.current?.(part);
  }, []);

  // Imperative export-image handle: Canvas writes the handle on each render.
  // The ExportImageDialog reads it to produce the export (single PNG or tiled print).
  const exportImageRef = useRef<import('./ExportImageDialog').ExportHandle | null>(null);
  const onExportImage = useCallback(() => {
    setShowExportImage(true);
  }, []);

  // Imperative canvas-action handle (clipboard, delete, rotate, z-order,
  // zoom, insert text): Canvas writes the functions on every render so the
  // header toolbar and menus can call them without lifting canvas state
  // up to Editor.
  const canvasActionsRef = useRef<CanvasActions | null>(null);

  // Unsaved-changes guard. The useLayoutDoc hook tracks save status;
  // we block navigation when there are pending writes by returning a
  // string from the beforeunload handler (works in all browsers except
  // Chrome 119+ where custom messages are suppressed, but the dialog
  // still blocks).
  const isDirty = status.kind === 'reconnecting' || status.kind === 'error';
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // The Canvas component hosts the keyboard-shortcut listener and
  // dispatches `cld:open-find` so the parent (which owns the dialog
  // state) can react. Same for the Insert-Text dialog if we ever want
  // to open it from the canvas via a keyboard route. (Add Text is
  // currently driven from a Map-menu button only.)
  useEffect(() => {
    const onOpenFind = () => setShowFind(true);
    const onOpenPrefs = () => setShowPreferences(true);
    const onOpenLabel = () => setShowAddLabel(true);
    window.addEventListener('cld:open-find', onOpenFind);
    window.addEventListener('cld:open-preferences', onOpenPrefs);
    window.addEventListener('cld:open-label', onOpenLabel);
    return () => {
      window.removeEventListener('cld:open-find', onOpenFind);
      window.removeEventListener('cld:open-preferences', onOpenPrefs);
      window.removeEventListener('cld:open-label', onOpenLabel);
    };
  }, []);

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

  // Subscribe to ALL doc changes; the projection is shared (cached per
  // doc) with the canvas and panels, so this costs no extra docToBbm.
  const docMap = useDocMap(doc);
  // Budget limits live in the doc's meta (shared with collaborators,
  // undoable). A meta change yields a new docMap, so re-read on that.
  const budgetLimits = useMemo(
    () => (doc ? readBudgetLimits(doc) : new Map<string, number>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, docMap],
  );

  // The active layer defaults to the first brick layer in the doc, if any.
  // Without an active layer the place tool has nowhere to put bricks.
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);

  // Reset stale activeLayerId when switching layouts. The Zustand store
  // persists across React navigation, so if the user goes Library →
  // open Layout A → navigate back → open Layout B, the store still
  // holds Layout A's layer id which won't match any layer in Layout B.
  // Clearing it here lets the effect below re-pick the first brick layer.
  useEffect(() => {
    setActiveLayer(null);
    useEditorStore.getState().setSelection([]);
    // Record the last-visited layout for "reopen last file" (general/reopenLastFile).
    localStorage.setItem('cld:lastLayoutId', layoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutId]);

  useEffect(() => {
    if (!doc) return;
    try {
      const map = projectDoc(doc);
      if (!map) return;
      const firstBrick = map.layers.find((l) => l.type === 'brick');
      if (!firstBrick) return;
      // If the current activeLayerId still exists in this map (of ANY
      // layer kind — the user may have deliberately activated an area,
      // text, or ruler layer via the Layers panel), keep it. Only pick a
      // fallback when there's no valid active layer at all (stale id
      // from another layout, or null on first load): default to the
      // first brick layer since tools that place parts need one.
      const current = useEditorStore.getState().activeLayerId;
      const stillValid = current && map.layers.some((l) => l.id === current);
      if (!stillValid) setActiveLayer(firstBrick.id);
    } catch {
      // Doc isn't fully populated yet (e.g. blank-create layout). Phase 3
      // doesn't seed an empty doc with default layers; the editor shows
      // an empty-state hint and the user must import a `.bbm`.
    }
  }, [doc, activeLayerId, setActiveLayer]);

  // Dock layout — per-user persisted (localStorage). Left and right
  // columns are shown when their respective zone has any panels.
  // IMPORTANT: this must run BEFORE the early returns below; otherwise
  // when loading flips false the hook count changes mid-tree and
  // React throws #310 ("rendered more hooks than during previous").
  const dock = useDockLayout(me.data?.user?.id ?? null);
  const showLeft = !viewport.isMobile && !isViewer && dock.state.left.length > 0;
  const showRight = !viewport.isMobile && !isViewer && dock.state.right.length > 0;

  if (loadError) return <ErrorScreen err={loadError} />;
  if (loading || !doc) return <LoadingScreen />;

  // Three fixed columns: left dock | canvas | right dock. Each dock
  // collapses to 0 when empty so we don't have to juggle headerColSpan
  // and grid-auto-flow ordering. Widths come from the persisted dock
  // state so the user's resize survives reload.
  const leftWidthPx = showLeft ? `${dock.state.leftWidth}px` : '0px';
  const rightWidthPx = showRight ? `${dock.state.rightWidth}px` : '0px';
  const cols = `${leftWidthPx} 1fr ${rightWidthPx}`;
  const headerColSpan = 3;

  // Returns just the inner content for a panel (shared by docked + floating).
  function panelBody(panelId: string): React.ReactNode {
    if (!doc) return null;
    if (panelId === 'parts') return <PartsPanel onPlacePart={onPlacePart} />;
    if (panelId === 'layers') return <LayersPanelHost doc={doc} isViewer={isViewer} />;
    if (panelId === 'usedparts') return <UsedPartsPanel doc={doc} budgetLimits={budgetLimits} />;
    if (panelId === 'modules') return <Suspense fallback={null}><ModulesPanel doc={doc} isViewer={isViewer} /></Suspense>;
    if (panelId === 'modlibrary') return <Suspense fallback={null}><ModuleLibraryPanel doc={doc} isViewer={isViewer} /></Suspense>;
    if (panelId === 'venuelibrary') return <Suspense fallback={null}><VenueLibraryPanel doc={doc} isViewer={isViewer} /></Suspense>;
    return null;
  }

  function renderPanel(panelId: string, dockZone: 'left' | 'right'): React.ReactNode {
    if (!doc) return null;
    const zone = dock.zoneOf(panelId);
    const onMove = (id: string, z: DockZone) => dock.setZone(id, z);
    const onReorder = (fromId: string, toId: string) => dock.reorderPanel(dockZone, fromId, toId);
    const title = PANEL_TITLES[panelId] ?? panelId;
    return (
      <PanelHost panelId={panelId} title={title} zone={zone} onMove={onMove} onReorder={onReorder}>
        {panelBody(panelId)}
      </PanelHost>
    );
  }

  return (
    <div
      className="grid h-screen grid-rows-[auto_1fr_auto] bg-neutral-950"
      style={{ gridTemplateColumns: viewport.isMobile ? '1fr' : cols }}
    >
      <header
        className="flex items-center justify-between border-b border-neutral-800 px-4 py-2"
        style={{ gridColumn: `span ${headerColSpan}` }}
      >
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-neutral-400 hover:underline">
            ← Layouts
          </Link>
          {!isViewer && (
            <>
              <button
                title="New layout (Ctrl+N)"
                onClick={() => {
                  if (status.kind === 'reconnecting' || status.kind === 'offline' || status.kind === 'error') {
                    if (!confirm('Changes may not be saved. Leave anyway?')) return;
                  }
                  window.location.href = '/';
                }}
                className="rounded-sm border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
              >
                New
              </button>
              <button
                title="Open layout (Ctrl+O)"
                onClick={() => {
                  if (status.kind === 'reconnecting' || status.kind === 'offline' || status.kind === 'error') {
                    if (!confirm('Changes may not be saved. Leave anyway?')) return;
                  }
                  window.location.href = '/';
                }}
                className="rounded-sm border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
              >
                Open
              </button>
            </>
          )}
          <h1 className="text-sm font-semibold">
            {meta.data?.layout.title ?? 'Untitled'}
          </h1>
          <SaveStatusIndicator status={status} />
          <PresencePanel awareness={awareness} />
        </div>
        <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
          <button
            onClick={undo.undo}
            disabled={!undo.canUndo}
            title="Undo (Cmd-Z)"
            className="shrink-0 rounded-sm border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
          >
            Undo
          </button>
          <button
            onClick={undo.redo}
            disabled={!undo.canRedo}
            title="Redo (Cmd-Shift-Z)"
            className="shrink-0 rounded-sm border border-neutral-700 px-2 py-1 text-xs disabled:opacity-30"
          >
            Redo
          </button>
          {!isViewer && (
            <HeaderEditButtons
              saveNow={saveNow}
              canvasActionsRef={canvasActionsRef}
            />
          )}
          {!isViewer && <Toolbar />}
          {!isViewer && <SnapPicker />}
          {!isViewer && <RotationPicker />}
          {!isViewer && <PaintColorPicker />}
          {!isViewer && (
            <PanelsMenu
              dock={dock.state}
              onToggle={(id, visible) => dock.setZone(id, visible ? 'right' : 'hidden')}
            />
          )}
          {!isViewer && (
            <MapMenu
              onGeneralInfo={() => setShowGeneralInfo(true)}
              onBackgroundColor={() => setShowBackgroundColor(true)}
              onBackgroundImage={() => setShowBackgroundImage(true)}
              onFind={() => setShowFind(true)}
              onExportImage={onExportImage}
              onExportCsv={() => {
                if (!doc) return;
                if (docMap) exportPartListCsv(docMap);
              }}
              onSaveModule={() => setShowSaveModule(true)}
              onImportBbm={() => setShowImportBbm(true)}
              onCreateModule={() => createModuleFromSelection(doc)}
              onSaveAsSet={() => setShowSaveAsSet(true)}
              onInsertLabel={() => setShowAddLabel(true)}
              onInsertText={() => canvasActionsRef.current?.insertText()}
              onZoomIn={() => canvasActionsRef.current?.zoom(ZOOM_STEP)}
              onZoomOut={() => canvasActionsRef.current?.zoom(1 / ZOOM_STEP)}
              onFit={() => canvasActionsRef.current?.fit()}
              onDownloadBbm={() => void downloadLocalBbm(doc, meta.data?.layout.title ?? 'layout')}
              onPreferences={() => setShowPreferences(true)}
              onVenueProps={() => setShowVenueProps(true)}
              onVenueDimensions={() => setShowVenueDimensions(true)}
              onVenueClear={() => {
                if (!doc) return;
                if (!confirm('Remove the entire venue from this project?')) return;
                setVenue(doc, null);
              }}
              onVenueDrawOutline={() => {
                useEditorStore.getState().setTool('venueOutline');
              }}
              onVenueDrawObstacle={() => {
                useEditorStore.getState().setTool('venueObstacle');
              }}
              onBudget={() => setShowBudget((v) => !v)}
              onVenueSaveToLibrary={() => {
                if (!doc) return;
                const venue = readSidecarFromDoc(doc)?.venue;
                if (!venue) { alert('No venue defined on this layout.'); return; }
                setShowVenueSaveLibrary(true);
              }}
              onVenueExportFile={() => {
                if (!doc) return;
                const venue = readSidecarFromDoc(doc)?.venue;
                if (!venue) { alert('No venue defined on this layout.'); return; }
                // Desktop format (VenueIO.cpp): *.bld-venue, schema bld-venue/1.
                const blob = new Blob([writeVenueFile(venue)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${venue.name || 'venue'}${VENUE_FILE_EXT}`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              onVenueLoadFromFile={() => {
                if (!doc) return;
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = VENUE_FILE_ACCEPT;
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  file.text().then((text) => {
                    try {
                      setVenue(doc, parseVenueFile(text));
                    } catch (e) {
                      alert(`Could not load venue file: ${(e as Error).message}`);
                    }
                  });
                };
                input.click();
              }}
            />
          )}
          {!isViewer && (
            <button
              onClick={() => setShowInsertModule(true)}
              className="rounded-sm border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800 whitespace-nowrap"
              title="Insert a saved module"
            >
              Insert module
            </button>
          )}
          <button
            onClick={() => setShowShare(true)}
            className="shrink-0 rounded-sm border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
          >
            Share
          </button>
          {!isViewer && (
            <button
              onClick={() => void saveNow()}
              className="shrink-0 rounded-sm bg-blue-600 px-3 py-1 text-sm hover:bg-blue-500"
            >
              Save
            </button>
          )}
          {isViewer && (
            <span className="rounded-sm bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300">
              View only
            </span>
          )}
        </div>
      </header>
      {showLeft && (
        <DockColumn
          panels={dock.state.left}
          renderPanel={(id) => renderPanel(id, 'left')}
          gridColumn="1"
          panelHeights={dock.state.panelHeights}
          onResizePanel={dock.setPanelHeight}
          edge={
            // The drag-handle on the LEFT dock sits on its right edge:
            // when the user drags it, `clientX` is the new column
            // width measured from the left of the screen.
            <Resizer axis="column" onResize={(clientX) => dock.setDockWidth('left', clientX)} />
          }
          edgeSide="end"
        />
      )}
      <main
        className="relative overflow-hidden"
        style={{ gridColumn: '2', gridRow: '2' }}
      >
        <Canvas doc={doc} awareness={awareness} isViewer={isViewer} saveNow={saveNow} status={status} placeAtCenterRef={placeAtCenterRef} exportImageRef={exportImageRef} canvasActionsRef={canvasActionsRef} undo={undo} onOpenVenueProps={() => setShowVenueProps(true)} onSaveModule={() => setShowSaveModule(true)} />
      </main>
      {showRight && (
        <DockColumn
          panels={dock.state.right}
          renderPanel={(id) => renderPanel(id, 'right')}
          gridColumn="3"
          panelHeights={dock.state.panelHeights}
          onResizePanel={dock.setPanelHeight}
          edge={
            // The drag-handle on the RIGHT dock sits on its left edge:
            // the new width is `viewport.width - clientX`.
            <Resizer
              axis="column"
              onResize={(clientX) =>
                dock.setDockWidth('right', window.innerWidth - clientX)
              }
            />
          }
          edgeSide="start"
        />
      )}
      {/* Floating panels — rendered via portal into document.body */}
      {dock.state.float.map((id) => {
        const pos = dock.state.floatPos[id];
        if (!pos) return null;
        return (
          <FloatingPanel
            key={id}
            panelId={id}
            title={PANEL_TITLES[id] ?? id}
            pos={pos}
            onMove={(pid, z) => dock.setZone(pid, z)}
            onPosChange={dock.setFloatPos}
          >
            {panelBody(id)}
          </FloatingPanel>
        );
      })}
      <Suspense fallback={null}>
      {showShare && me.data?.user && meta.data && (
        <ShareDialog
          layoutId={layoutId}
          layoutTitle={meta.data.layout.title}
          myRole={role}
          myUserId={me.data.user.id}
          onClose={() => setShowShare(false)}
        />
      )}
      {/* Status bar — port of MainWindow.cpp:861-1014 status widgets.
          Spans every column. Shows mouse coords / selection count / zoom. */}
      <StatusBar
        gridSpan={headerColSpan}
        status={status}
        venue={doc ? (readSidecarFromDoc(doc)?.venue ?? null) : null}
        budgetLimits={budgetLimits}
        budgetMap={docMap}
      />

      {showInsertModule && (
        <InsertModuleDialog doc={doc} onClose={() => setShowInsertModule(false)} />
      )}
      {showSaveModule && docMap && (
        <SaveModuleDialog
          map={docMap}
          selection={useEditorStore.getState().selection}
          onClose={() => setShowSaveModule(false)}
          onSaved={(_id, title) => {
            setShowSaveModule(false);
            alert(`Module "${title}" saved.`);
          }}
        />
      )}
      {showGeneralInfo && docMap && (
        <GeneralInfoDialog map={docMap} doc={doc} onClose={() => setShowGeneralInfo(false)} />
      )}
      {showBackgroundColor && docMap && (
        <BackgroundColorDialog
          current={docMap.backgroundColor}
          doc={doc}
          onClose={() => setShowBackgroundColor(false)}
        />
      )}
      {showBackgroundImage && (
        <BackgroundImageDialog
          layoutId={layoutId}
          doc={doc}
          onClose={() => setShowBackgroundImage(false)}
        />
      )}
      {showFind && docMap && (
        <FindDialog map={docMap} doc={doc} onClose={() => setShowFind(false)} />
      )}
      {showExportImage && (
        <ExportImageDialog
          layoutTitle={meta.data?.layout.title ?? 'layout'}
          exportImageRef={exportImageRef}
          onClose={() => setShowExportImage(false)}
        />
      )}
      {showPreferences && (
        <PreferencesDialog onClose={() => setShowPreferences(false)} />
      )}
      {showImportBbm && (
        <ImportBbmDialog doc={doc} onClose={() => setShowImportBbm(false)} />
      )}
      {showSaveAsSet && doc && (
        <SaveAsSetDialog
          doc={doc}
          onClose={() => setShowSaveAsSet(false)}
        />
      )}
      {showAddLabel && (
        <AddAnchoredLabelDialog
          doc={doc}
          defaultTargetId={
            useEditorStore.getState().selection.length === 1
              ? (useEditorStore.getState().selection[0] ?? null)
              : null
          }
          viewCentre={canvasActionsRef.current?.viewCentre() ?? viewCentreStuds(viewport)}
          onClose={() => setShowAddLabel(false)}
        />
      )}
      {showVenueSaveLibrary && doc && (() => {
        const venue = readSidecarFromDoc(doc)?.venue;
        if (!venue) return null;
        return (
          <VenueSaveLibraryDialog
            venueName={venue.name || ''}
            orgs={myOrgs.data?.orgs ?? []}
            onSave={(orgSlug) => {
              const createArgs = orgSlug
                ? { name: venue.name || 'Unnamed Venue', data: venue, orgSlug }
                : { name: venue.name || 'Unnamed Venue', data: venue };
              void api.venues.create(createArgs).then(() => {
                useEditorStore.getState().showStatusMessage('Venue saved to library.');
              }).catch(() => alert('Failed to save venue to library.'));
              setShowVenueSaveLibrary(false);
            }}
            onClose={() => setShowVenueSaveLibrary(false)}
          />
        );
      })()}
      {showVenueProps && doc && (
        <VenuePropertiesDialog
          doc={doc}
          venue={readSidecarFromDoc(doc)?.venue ?? null}
          onClose={() => setShowVenueProps(false)}
        />
      )}
      {showVenueDimensions && doc && (
        <VenueDimensionsDialog
          doc={doc}
          onClose={() => setShowVenueDimensions(false)}
        />
      )}
      {showBudget && (
        <BudgetDialog
          map={docMap}
          limits={budgetLimits}
          onLimitsChange={(next) => setBudgetLimits(doc, next)}
          onClose={() => setShowBudget(false)}
        />
      )}
      </Suspense>
    </div>
  );
}

function Canvas({
  doc,
  awareness,
  isViewer,
  saveNow,
  status,
  placeAtCenterRef,
  exportImageRef,
  canvasActionsRef,
  undo,
  onOpenVenueProps,
  onSaveModule,
}: {
  doc: import('yjs').Doc;
  awareness: import('y-protocols/awareness').Awareness | null;
  isViewer: boolean;
  saveNow: () => Promise<void> | void;
  status: import('./useLayoutDoc').SaveStatus;
  placeAtCenterRef: React.MutableRefObject<((part: PartWire) => void) | null>;
  exportImageRef: React.MutableRefObject<import('./ExportImageDialog').ExportHandle | null>;
  canvasActionsRef: React.MutableRefObject<CanvasActions | null>;
  undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onOpenVenueProps: () => void;
  onSaveModule: () => void;
}) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const hudLayerRef = useRef<Konva.Layer | null>(null);
  const { width, height } = useViewportSize();
  // Pan/zoom are plain React state, passed straight to <Stage> as
  // x/y/scaleX/scaleY props below. (An earlier version additionally
  // pushed these onto the Stage node imperatively via a raw
  // `useEditorStore.subscribe`, with no selector — that callback fired
  // on EVERY store write, including the hud-mouse-coord update on every
  // single mousemove, so a `stage.batchDraw()` ran on every pixel of
  // mouse movement, including during a brick drag. It was pure
  // redundant work — the props below already keep the Stage in sync —
  // and competed with Konva's own drag-move redraws, making drags feel
  // like they stalled or wouldn't move. Removed; see issue about
  // dragging bricks being unresponsive.)
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const tool = useEditorStore((s) => s.tool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const setActiveLayer = useEditorStore((s) => s.setActiveLayer);
  const selection = useEditorStore((s) => s.selection);
  const snapStepStuds = useEditorStore((s) => s.snapStepStuds);
  const rotationStepDegrees = useEditorStore((s) => s.rotationStepDegrees);
  const setSelection = useEditorStore((s) => s.setSelection);
  const showElectricCircuits = useEditorStore((s) => s.showElectricCircuits);
  const venueLabelPx = useEditorStore((s) => s.venueLabelPx);



  // External drag-from-Parts-panel state. While the user is dragging a
  // thumbnail over the canvas the panel emits a custom MIME (key) on
  // dragover; we render the same PlaceGhost as the place tool so the
  // user sees a live preview with snap-to-connection. Mirrors desktop
  // `MapView::dragMoveEvent` + `updateDragPreview` (MapView.cpp:1678-1761).
  const [dropPart, setDropPart] = useState<{ key: string; studX: number; studY: number } | null>(null);
  // Same for a module dragged from the Module Library: cursor position
  // plus the module's snapshot, fetched once per drag (MapView.cpp:1796-1900).
  const [dropModule, setDropModule] = useState<{ studX: number; studY: number } | null>(null);
  const moduleDragRef = useRef<{ key: string; batches: Promise<ModuleBatch[]>; ready: ModuleBatch[] | null } | null>(null);
  const [, setModuleDragReady] = useState(0);

  // Marquee state. Active while the user is dragging in select mode on
  // empty stage. Mouse-up commits the intersection to selection.
  const [marquee, setMarquee] = useState<import('./render/MarqueeOverlay').Marquee | null>(null);
  const marqueeAdditiveRef = useRef(false);

  // Context-menu state — position in viewport px + whether the click
  // landed on a brick (drives the selection-aware entry list).
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    studX: number;
    studY: number;
    onBrick: boolean;
    textCellRef: TextCellRef | null;
    rulerRef: { item: import('@cld/model').RulerItem; layerId: string } | null;
    brickIdUnderCursor: string | null;
  } | null>(null);

  // Edit-Brick dialog state — opened by double-click on a brick.
  const [editing, setEditing] = useState<
    { brick: import('@cld/model').Brick; layerId: string; meta: PartWire | undefined } | null
  >(null);

  const onEditBrick = useCallback(
    (brick: import('@cld/model').Brick, layerId: string, meta: PartWire | undefined) =>
      setEditing({ brick, layerId, meta }),
    [],
  );

  // Edit-AnchoredLabel dialog state — opened by double-click on a label.
  const [editingLabel, setEditingLabel] = useState<import('@cld/bbm').AnchoredLabel | null>(null);

  // Mixed selection: rulers, anchored labels and text cells selected
  // alongside bricks (store `annoSelection`; desktop Qt scene selection,
  // MapViewDrag.cpp:124-153). Endpoint handles and the ruler-attach menu
  // need exactly one ruler.
  const annoSelection = useEditorStore((s) => s.annoSelection);
  const selectedRulerIds = useMemo(() => new Set(annoSelection.rulers), [annoSelection.rulers]);
  const selectedLabelIds = useMemo(() => new Set(annoSelection.labels), [annoSelection.labels]);
  const selectedTextKeys = useMemo(() => new Set(annoSelection.texts), [annoSelection.texts]);
  const selectedRulerId = annoSelection.rulers.length === 1 ? annoSelection.rulers[0]! : null;
  /** Select an annotation: plain click → just it; Shift/Ctrl → toggle, keep the rest. */
  const selectAnno = useCallback((kind: keyof AnnoSelection, id: string, additive: boolean) => {
    const st = useEditorStore.getState();
    const next = clickAnno(st.selection, st.annoSelection, kind, id, additive);
    st.setMixedSelection(next.bricks, next.anno);
  }, []);
  const [editingRuler, setEditingRuler] = useState<
    { item: import('@cld/model').RulerItem; layerId: string } | null
  >(null);

  // Add-Text dialog state — opened by Ctrl+T.
  const [showAddText, setShowAddText] = useState(false);
  // Where "Add Text Here…" was invoked (studs); null = at the cursor.
  const [addTextAt, setAddTextAt] = useState<{ x: number; y: number } | null>(null);

  // Edit-Text dialog state — opened by double-click or context menu on a text cell.
  const [editingText, setEditingText] = useState<TextCellRef | null>(null);

  // Ruler-draw draft (linear or circular) — start point + current
  // mouse pos in stud space. Cleared on commit / cancel. Mirrors
  // desktop's `drawingRuler_` flag (MapView.cpp:454-468).
  const [rulerDraft, setRulerDraft] = useState<{
    kind: 'linear' | 'circular';
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  // Venue-draw draft — accumulated polygon vertices in stud space.
  // `curX/curY` tracks the live preview cursor vertex.
  // Used for both venueOutline and venueObstacle tools.
  const [venueDraft, setVenueDraft] = useState<{
    kind: 'outline' | 'obstacle';
    pts: { x: number; y: number }[];
    curX: number;
    curY: number;
  } | null>(null);

  // Middle-button pan anchor — desktop MapView::mousePressEvent path at
  // MapView.cpp:446-451 ("if (e->button() == Qt::MiddleButton)").
  // While held, mousemove translates panX/panY by the cursor delta.
  const middlePanRef = useRef<{ lastX: number; lastY: number } | null>(null);

  // Wheel-zoom coalescer. Multiple wheel events landing inside the same
  // animation frame (common on high-res trackpads — they fire 60+ Hz)
  // get merged and applied once on the next rAF, so the Yjs+catalog
  // re-render runs at frame rate instead of per-event.
  const zoomAccumRef = useRef<{ deltaY: number; ptrX: number; ptrY: number; raf: number | null }>(
    { deltaY: 0, ptrX: 0, ptrY: 0, raf: null },
  );

  // HUD mouse-coord coalescer. `setHudMouse` only feeds the status bar's
  // "Mouse: x, y" readout, which doesn't need per-pixel precision — but
  // writing it on every raw mousemove (which also fires continuously
  // while dragging a brick) forced a StatusBar re-render at native mouse
  // frequency. Coalesce to one write per frame instead.
  const hudMouseRafRef = useRef<{ x: number; y: number } | null | undefined>(undefined);
  const hudMouseRafIdRef = useRef<number | null>(null);
  function scheduleHudMouse(studs: { x: number; y: number } | null) {
    hudMouseRafRef.current = studs;
    if (hudMouseRafIdRef.current !== null) return;
    hudMouseRafIdRef.current = requestAnimationFrame(() => {
      hudMouseRafIdRef.current = null;
      const pending = hudMouseRafRef.current;
      hudMouseRafRef.current = undefined;
      if (pending === undefined) return;
      useEditorStore.getState().setHudMouse(pending?.x ?? null, pending?.y ?? null);
    });
  }
  useEffect(() => {
    return () => {
      if (hudMouseRafIdRef.current !== null) cancelAnimationFrame(hudMouseRafIdRef.current);
    };
  }, []);

  // Paint/erase stroke tracker — set of `${cx},${cy}` cells already
  // touched in the current stroke so we don't re-emit the same Yjs
  // change for cells the cursor crosses multiple times. Mirrors
  // desktop's `strokeCellsTouched_` (MapView.cpp:493-523).
  const paintStrokeRef = useRef<Set<string> | null>(null);

  // Shared cached projection (see useDocMap): same object until the doc
  // changes, and unchanged bricks keep their identity across edits so the
  // memoised brick glyphs skip re-rendering.
  const map = useDocMap(doc);
  const mapRef = useRef(map);
  mapRef.current = map;

  // Ruler- or label-led drag of a mixed selection. Qt moves every
  // selected movable item with the grabbed one and commitDragIfMoved
  // pushes one "Drag" macro (MapViewDrag.cpp:412-450); bricks then get
  // the grid snap of the first brick's top-left (MapViewDrag.cpp:600-608).
  const annoDragRef = useRef<{
    lead: Konva.Node;
    x0: number;
    y0: number;
    others: NodeSnap[];
    bricks: string[];
    anno: AnnoSelection;
  } | null>(null);
  const annoDrag = useMemo<AnnoDragHandlers>(() => ({
    start(kind, id, node) {
      const st = useEditorStore.getState();
      let bricks = st.selection;
      let anno = st.annoSelection;
      if (!anno[kind].includes(id)) {
        bricks = [];
        anno = { rulers: [], labels: [], texts: [], [kind]: [id] };
        st.setMixedSelection(bricks, anno);
      }
      const names = [...bricks.map((b) => `brick-${b}`), ...annoNodeNames(anno)];
      annoDragRef.current = {
        lead: node,
        x0: node.x(),
        y0: node.y(),
        others: collectNodes(node.getStage(), names, node),
        bricks,
        anno,
      };
    },
    move(node) {
      const d = annoDragRef.current;
      if (!d || d.lead !== node) return;
      shiftNodes(d.others, node.x() - d.x0, node.y() - d.y0);
    },
    end(node) {
      const d = annoDragRef.current;
      annoDragRef.current = null;
      if (!d || d.lead !== node) return;
      const dx = pxToStud(node.x() - d.x0);
      const dy = pxToStud(node.y() - d.y0);
      restoreNodes(d.others);
      node.position({ x: d.x0, y: d.y0 });
      const m = mapRef.current;
      if (!m || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6)) return;
      let brickDx = dx;
      let brickDy = dy;
      const step = useEditorStore.getState().snapStepStuds;
      if (step > 0 && d.bricks.length > 0) {
        const first = m.layers
          .flatMap((l) => (l.type === 'brick' ? l.bricks : []))
          .find((b) => d.bricks.includes(b.id));
        if (first) {
          const tlx = first.displayArea.x + dx;
          const tly = first.displayArea.y + dy;
          brickDx += Math.round(tlx / step) * step - tlx;
          brickDy += Math.round(tly / step) * step - tly;
        }
      }
      const sc = readSidecarFromDoc(doc);
      translateMixedSelection(doc, m, sc?.anchoredLabels ?? [], sc?.modules ?? [], {
        bricks: d.bricks,
        anno: d.anno,
        dx,
        dy,
        brickDx,
        brickDy,
      });
    },
  }), [doc]);

  /**
   * Resolve the layer that new parts should be placed into. `activeLayerId`
   * is the Layers-panel selection and can legitimately point at ANY layer
   * kind (area, text, ruler — the user may have clicked one on purpose).
   * Placing tools need a brick layer specifically: use the active layer
   * only when it IS a brick layer, otherwise fall back to the first brick
   * layer in the doc, creating one if none exists.
   */
  function resolveBrickLayerForPlacement(): string {
    if (activeLayerId && map?.layers.some((l) => l.id === activeLayerId && l.type === 'brick')) {
      return activeLayerId;
    }
    const firstBrick = map?.layers.find((l) => l.type === 'brick');
    return firstBrick?.id ?? ensureBrickLayer(doc);
  }

  // Push map bounding-box into the store so the StatusBar can show it
  // without prop-drilling. Runs whenever the map changes.
  const setHudMapBounds = useEditorStore((s) => s.setHudMapBounds);
  useEffect(() => {
    if (!map) { setHudMapBounds(null, null); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        minX = Math.min(minX, b.displayArea.x);
        minY = Math.min(minY, b.displayArea.y);
        maxX = Math.max(maxX, b.displayArea.x + b.displayArea.width);
        maxY = Math.max(maxY, b.displayArea.y + b.displayArea.height);
      }
    }
    if (!Number.isFinite(minX)) { setHudMapBounds(null, null); return; }
    setHudMapBounds(maxX - minX, maxY - minY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Index parts by key for fast place-tool lookup.
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });
  const partsByKey = useMemo(() => {
    // Bricks reference the catalog KEY (`<partNumber>.<colorCode>`
    // lowercased) in their `partNumber` field — index by that, then
    // also stash the bare `partNumber` as a fallback for entries
    // arriving without a colour code (group parts / some custom uploads).
    // Inconsistent indexing was breaking the snap helpers — see
    // editor/snap.ts `lookupPart`.
    const m = new Map<string, PartWire>();
    for (const p of catalog.data?.parts ?? []) {
      m.set(p.key.toLowerCase(), p);
      const bare = p.partNumber.toLowerCase();
      if (!m.has(bare)) m.set(bare, p);
    }
    return m;
  }, [catalog.data]);

  /** Unrotated sprite size of a brick in studs, once its sprite is loaded (marquee shape near 45°). */
  function brickSpriteStuds(b: { partNumber: string }): { w: number; h: number } | null {
    const meta = partsByKey.get(b.partNumber.toLowerCase());
    const sprite = meta ? getSpriteSync(spriteUrlFor(meta)) : null;
    if (!meta || !sprite) return null;
    const pxPerStud = meta.pxPerStud && meta.pxPerStud > 0 ? meta.pxPerStud : 8;
    return { w: sprite.naturalWidth / pxPerStud, h: sprite.naturalHeight / pxPerStud };
  }

  // Drag-from-Parts-panel → drop on canvas. The Stage's container <div>
  // receives native HTML5 drag events. We accept the custom MIME type
  // emitted by PartsPanel, render a live ghost via `dropPart` while
  // dragover, and commit a `placePartAt` on drop. Direct port of
  // MapView::dragEnterEvent / dragMoveEvent / dropEvent (lines 1659-2042).
  // Latest drag-hover part, readable synchronously from the drop handler
  // (the Firefox fallback used to read a stale `dropPart` closure).
  const dropPartRef = useRef<{ key: string; studX: number; studY: number } | null>(null);
  const dropHandlersRef = useRef<{
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  } | null>(null);
  {
    const PART_MIME = 'application/x-cld-part';

    function clientToStuds(clientX: number, clientY: number): { x: number; y: number } | null {
      const container = stageRef.current?.container();
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      // Apply inverse of stage transform (live values, not the render's).
      const { panX: livePanX, panY: livePanY, zoom: liveZoom } = useEditorStore.getState();
      return {
        x: pxToStud((px - livePanX) / liveZoom),
        y: pxToStud((py - livePanY) / liveZoom),
      };
    }

    function updateDropPart(next: { key: string; studX: number; studY: number } | null) {
      dropPartRef.current = next;
      setDropPart(next);
    }

    function readPartKey(dt: DataTransfer | null): string | null {
      if (!dt) return null;
      // dataTransfer.getData on dragover is reliably empty in some
      // browsers (Firefox); we accept either MIME but only test
      // presence in `types` so dragover updates fire even before
      // dragstart populated the buffer.
      if (!dt.types || dt.types.length === 0) return null;
      const has =
        Array.from(dt.types).some(
          (t) => t === PART_MIME || t === 'text/plain',
        );
      if (!has) return null;
      try {
        return dt.getData(PART_MIME) || dt.getData('text/plain') || '';
      } catch {
        return '';
      }
    }

    /** The module snapshot for this drag — fetched once, shared by ghost and drop. */
    function moduleDragBatches(id: string) {
      const key = `${activeModuleDrag.session}:${id}`;
      let entry = moduleDragRef.current;
      if (!entry || entry.key !== key) {
        const batches = fetchModuleBatches(id);
        const next = { key, batches, ready: null as ModuleBatch[] | null };
        batches
          .then((b) => {
            next.ready = b;
            setModuleDragReady((n) => n + 1);
          })
          .catch(() => undefined);
        moduleDragRef.current = entry = next;
      }
      return entry;
    }

    function onDragOver(e: DragEvent) {
      const dt = e.dataTransfer;
      if (!dt) return;
      // Quick MIME sniff — avoid hijacking unrelated drags.
      const types = Array.from(dt.types ?? []);
      const isModule = types.includes(MODULE_MIME);
      if (!isModule && !types.includes(PART_MIME) && !types.includes('text/plain')) return;
      e.preventDefault();
      dt.dropEffect = 'copy';
      useEditorStore.getState().setDropTargetHint(dropTargetHint(map?.layers ?? [], activeLayerId));
      const studs = clientToStuds(e.clientX, e.clientY);
      if (!studs) return;
      if (isModule) {
        // Ghost of the whole module where the drop will put it.
        const id = activeModuleDrag.id;
        if (!id) return;
        moduleDragBatches(id);
        setDropModule({ studX: studs.x, studY: studs.y });
        return;
      }
      const key = readPartKey(dt);
      // dragover on Firefox doesn't expose getData payloads — fall back
      // to the most-recently-stored key from a previous dragover.
      updateDropPart({
        key: key || dropPartRef.current?.key || '',
        studX: studs.x,
        studY: studs.y,
      });
    }

    function onDragLeave(_e: DragEvent) {
      updateDropPart(null);
      setDropModule(null);
      useEditorStore.getState().setDropTargetHint(null);
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      const dt = e.dataTransfer;
      const lastDropPart = dropPartRef.current;
      updateDropPart(null);
      setDropModule(null);
      useEditorStore.getState().setDropTargetHint(null);
      const dragged = moduleDragRef.current;
      moduleDragRef.current = null;

      // Module drop — fetch snapshot and insert bricks.
      const moduleIdRaw = dt?.getData(MODULE_MIME);
      const moduleId = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(moduleIdRaw ?? '')?.[1];
      if (moduleId) {
        const moduleName = dt?.getData(MODULE_NAME_MIME) || 'Module';
        const dropStuds = clientToStuds(e.clientX, e.clientY);
        const hostMap = map;
        const catalog = partsByKey;
        void (async () => {
          try {
            // Reuse the snapshot the ghost was drawn from, so the drop
            // lands exactly on the ghost.
            const batches = await (dragged && dragged.key === `${activeModuleDrag.session}:${moduleId}`
              ? dragged.batches
              : fetchModuleBatches(moduleId));
            // Desktop drop (MapView.cpp:1900-2060): centroid under the
            // cursor, bbox top-left on the grid, then a translation-only
            // connection snap onto the host's free ends.
            const offset = dropStuds
              ? moduleDropTranslation(
                  batches,
                  dropStuds,
                  useEditorStore.getState().snapStepStuds,
                  hostMap,
                  catalog,
                )
              : { dx: 0, dy: 0 };
            // Bricks go to host layers named like the module's layers and
            // are registered as a sidecar module in the same undo step.
            const res = importBricksAsModule(doc, batches, { name: moduleName, offset });
            if (res) {
              setSelection(res.ids);
              useEditorStore
                .getState()
                .showStatusMessage(`Imported ${res.ids.length} bricks from module '${moduleName}'`, 4000);
            }
          } catch { /* silent */ }
        })();
        return;
      }

      const key = readPartKey(dt) || lastDropPart?.key || '';
      const studs = clientToStuds(e.clientX, e.clientY);
      if (!key || !studs) return;
      const meta = partsByKey.get(key.toLowerCase());
      if (!meta) return;
      void placePartAt(meta, studs.x, studs.y);
    }

    // Refreshed every render so the listeners below (attached once per
    // stage) always run against the latest state / closures.
    dropHandlersRef.current = { onDragOver, onDragLeave, onDrop };
  }
  const hasStage = map !== null;
  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;
    const onDragOver = (e: DragEvent) => dropHandlersRef.current?.onDragOver(e);
    const onDragLeave = (e: DragEvent) => dropHandlersRef.current?.onDragLeave(e);
    const onDrop = (e: DragEvent) => dropHandlersRef.current?.onDrop(e);
    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
    };
  }, [hasStage]);

  /**
   * Fit the canvas to the brick AABB and centre on it. Shared between
   * the `F` shortcut, the `View → Fit to View` action, and the
   * auto-fit-on-open effect below. Mirrors desktop's `onFitToView`
   * (MainWindow.cpp:1348-1352) and the `setMap` initial fit
   * (MapView.cpp:300-308).
   *
   * Returns `true` when a fit was applied, `false` when the map has
   * no bricks (so the auto-fit effect can keep waiting for content
   * to land — important for fresh blank-create layouts where the doc
   * arrives empty and bricks come in via `.bbm` import a few ms later).
   */
  function fitToContent(): boolean {
    if (!map) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        minX = Math.min(minX, b.displayArea.x);
        minY = Math.min(minY, b.displayArea.y);
        maxX = Math.max(maxX, b.displayArea.x + b.displayArea.width);
        maxY = Math.max(maxY, b.displayArea.y + b.displayArea.height);
      }
    }
    if (!Number.isFinite(minX)) return false;
    const wPx = (maxX - minX) * 8;
    const hPx = (maxY - minY) * 8;
    if (wPx <= 0 || hPx <= 0) return false;
    const PAD = 1.1;
    const fitZoom = Math.min(width / (wPx * PAD), height / (hPx * PAD));
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom));
    const cxPx = ((minX + maxX) / 2) * 8;
    const cyPx = ((minY + maxY) / 2) * 8;
    useEditorStore.setState({
      zoom: z,
      panX: width / 2 - cxPx * z,
      panY: height / 2 - cyPx * z,
    });
    return true;
  }

  // Auto-fit on first open. Mirrors desktop's `MapView::setMap` final
  // call to `fitInView` (MapView.cpp:300-308). Fires once per browser
  // session per layout: as soon as the map has at least one brick AND
  // the canvas has real width/height, we centre + zoom to fit, then
  // never auto-fit again so the user's subsequent pan/zoom isn't
  // clobbered by Yjs updates.
  const autoFittedRef = useRef(false);
  useEffect(() => {
    if (autoFittedRef.current) return;
    if (!map || width <= 0 || height <= 0) return;
    if (fitToContent()) autoFittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, width, height]);

  // Finish the venue outline / obstacle being drawn and return to the
  // select tool. Enter or right-click, like desktop
  // MapView::finishVenueDraw (MapView.cpp:891-925): fewer than 3 points
  // drops them, says so and stays in the tool; drawing enables the venue.
  function finishVenueDraft() {
    if (isViewer) return;
    const kind = venueDraft?.kind ?? (tool === 'venueObstacle' ? 'obstacle' : 'outline');
    const next = venueAfterDraw(readSidecarFromDoc(doc)?.venue, kind, venueDraft?.pts ?? []);
    setVenueDraft(null);
    if (!next) {
      useEditorStore.getState().showStatusMessage(VENUE_MIN_POINTS_MESSAGE, 2500);
      return;
    }
    setVenue(doc, next);
    useEditorStore.getState().setTool('select');
  }

  // Canvas keyboard shortcuts — port of desktop MapView::keyPressEvent
  // (MapView.cpp:942-983) and MainWindowMenus.cpp shortcut bindings:
  //
  //   Escape                — cancel place / deselect
  //   Delete / Backspace    — delete selection                  (MapView.cpp:959)
  //   R                     — rotate CCW 90°                    (MapView.cpp:964, MainWindowMenus.cpp:423)
  //   Shift+R               — rotate CW 90°                     (MapView.cpp:964, MainWindowMenus.cpp:418)
  //   Arrow keys            — nudge selection by 1 stud         (MapView.cpp:970-980)
  //   Ctrl+A                — select all visible bricks          (MapView.cpp:1417)
  //   Ctrl+Shift+A          — select none                       (MainWindowMenus.cpp:362)
  // The handler is rebuilt every render (so it always sees the current
  // venueDraft / selection / map / status ...) and a single window
  // listener dispatches to the latest one. The previous effect listed its
  // deps by hand and missed several (venueDraft, pan/zoom, status), so
  // Enter/Escape for venue drawing never fired and Ctrl+V pasted at a
  // stale pointer position.
  const keyHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  {
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      // Escape — works regardless of viewer state.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (venueDraft) { setVenueDraft(null); return; }
        setSelection([]);
        setRulerDraft(null);
        return;
      }

      // Enter — commit venue-draw polygon (≥3 pts) or obstacle.
      if (e.key === 'Enter' && (venueDraft || tool === 'venueOutline' || tool === 'venueObstacle') && !isViewer) {
        e.preventDefault();
        finishVenueDraft();
        return;
      }

      // Ctrl/Cmd + A / Shift+A — select-all / select-none.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (e.shiftKey) {
          setSelection([]);
        } else if (map) {
          // Every brick on every visible brick layer, like desktop
          // MapView::selectAll (MapView.cpp:1417).
          setSelection(allVisibleBrickIds(map));
        }
        return;
      }

      // Ctrl/Cmd + S — explicit save. Desktop MainWindowMenus.cpp:89
      // (QKeySequence::Save). Yjs already auto-saves; this just nudges
      // an explicit flush.
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!isViewer) void saveNow();
        return;
      }

      // Ctrl/Cmd + C — copy selection to clipboard.
      // Ctrl/Cmd + X — cut. Ctrl/Cmd + V — paste at the current cursor.
      // Ctrl/Cmd + D — duplicate (= copy + paste in place + tiny offset).
      // All ports of MapViewClipboard.cpp.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        void copySelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        if (isViewer) return;
        void cutSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (isViewer) return;
        void pasteAtCursor();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (isViewer || selection.length === 0) return;
        void duplicateSelection();
        return;
      }

      // Ctrl/Cmd + Shift + ] — bring to front. Ctrl/Cmd + Shift + [ — send to back.
      // Desktop MainWindowMenus.cpp:391-396.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        if (isViewer || selection.length === 0) return;
        reorderBricks(doc, selection, 'front');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        if (isViewer || selection.length === 0) return;
        reorderBricks(doc, selection, 'back');
        return;
      }

      // Ctrl/Cmd + F — Find. Desktop MainWindowMenus.cpp:350.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        // Routed via the Editor parent's setShowFind via window event;
        // Canvas doesn't own that state. We dispatch a custom event the
        // Editor listens for at mount time.
        window.dispatchEvent(new CustomEvent('cld:open-find'));
        return;
      }

      // Ctrl/Cmd + , — Preferences dialog.
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('cld:open-preferences'));
        return;
      }

      // Ctrl/Cmd + T — Insert ▸ Text. Desktop MainWindowMenus.cpp:431.
      if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        if (isViewer) return;
        setShowAddText(true);
        return;
      }

      // Ctrl/Cmd + L — Insert ▸ Anchored Label. Desktop MainWindowMenus.cpp:440-472.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        if (isViewer) return;
        window.dispatchEvent(new CustomEvent('cld:open-label'));
        return;
      }

      // Ctrl/Cmd + G — group; Ctrl/Cmd + Shift + G — ungroup.
      // Desktop MainWindowMenus.cpp:371-374.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (isViewer) return;
        if (e.shiftKey) ungroupBricksAcrossLayers(doc, selectionByLayer());
        else groupBricksAcrossLayers(doc, selectionByLayer());
        return;
      }

      // Ctrl/Cmd + P — Select Path: BFS walk over connexion links from
      // the current selection, across all brick layers. Port of
      // MapView.cpp:1481-1543.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (!map) return;
        const adj = buildConnectedAdj(map);
        const visited = new Set<string>(selection);
        const queue = [...selection];
        while (queue.length > 0) {
          const id = queue.shift()!;
          for (const nb of adj.get(id) ?? []) {
            if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
          }
        }
        setSelection([...visited]);
        return;
      }

      // Ctrl/Cmd + N — New layout (navigate to layouts page then create).
      // Desktop MainWindowMenus.cpp:76-78. Guard with unsaved-changes prompt
      // when sync is broken (reconnecting / offline / error).
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        const s = status;
        if (s.kind === 'reconnecting' || s.kind === 'offline' || s.kind === 'error') {
          if (!confirm('Changes may not be saved. Leave anyway?')) return;
        }
        window.location.href = '/';
        return;
      }

      // Ctrl/Cmd + O — Open layout (navigate to layouts page).
      // Desktop MainWindowMenus.cpp:80-82.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        const s = status;
        if (s.kind === 'reconnecting' || s.kind === 'offline' || s.kind === 'error') {
          if (!confirm('Changes may not be saved. Leave anyway?')) return;
        }
        window.location.href = '/';
        return;
      }

      // Ctrl/Cmd + = / - — zoom in/out by a fixed factor (matches
      // desktop MainWindowMenus.cpp:493-498). Re-uses zoomAround so the
      // anchor stays under the canvas centre.
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        const factor = e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP;
        const live = useEditorStore.getState().zoom;
        useEditorStore.getState().zoomAround(live * factor, width / 2, height / 2);
        return;
      }

      // F — fit canvas to map extent. Desktop MainWindowMenus.cpp:501.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        fitToContent();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isViewer) return; // viewers can't mutate

      // Delete / arrow nudge act on the whole mixed selection: bricks on
      // any layer plus rulers, labels and text cells (delete) / rulers and
      // labels (nudge — desktop text cells don't move). MapView.cpp:959-1041.
      if (selection.length + annoCount(annoSelection) > 0 && map) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteSelection();
          return;
        }
        const NUDGE = snapStepStuds > 0 ? snapStepStuds : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -NUDGE;
        else if (e.key === 'ArrowRight') dx = NUDGE;
        else if (e.key === 'ArrowUp') dy = -NUDGE;
        else if (e.key === 'ArrowDown') dy = NUDGE;
        if (dx !== 0 || dy !== 0) {
          e.preventDefault();
          const sc = readSidecarFromDoc(doc);
          translateMixedSelection(doc, map, sc?.anchoredLabels ?? [], sc?.modules ?? [], {
            bricks: selection,
            anno: annoSelection,
            dx,
            dy,
          });
          return;
        }
      }

      if (selection.length === 0) return;

      if (e.key === 'r' || e.key === 'R') {
        // Shift+R = CW (+step), R = CCW (-step). Matches desktop's MainWindow
        // keys (MainWindowMenus.cpp:418,423) where Shift+R is CW and
        // bare R is CCW; step is the configured rotation step. The whole
        // selection (any layer) turns about its centroid.
        e.preventDefault();
        rotateBricksAboutCentroid(doc, selectionByLayer(), e.shiftKey ? rotationStepDegrees : -rotationStepDegrees);
        return;
      }
    }
    keyHandlerRef.current = onKey;
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandlerRef.current?.(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Read the pointer's stud-space coordinates (live pan/zoom). */
  function pointerStuds(): { x: number; y: number } | null {
    const stage = stageRef.current;
    if (!stage) return null;
    const ptr = stage.getPointerPosition();
    if (!ptr) return null;
    const { panX: livePanX, panY: livePanY, zoom: liveZoom } = useEditorStore.getState();
    return {
      x: pxToStud((ptr.x - livePanX) / liveZoom),
      y: pxToStud((ptr.y - livePanY) / liveZoom),
    };
  }

  // Per-frame coalescing for mousemove-driven React state (middle-button
  // pan, marquee, ruler / venue drafts). Raw mousemove fires at 60-240 Hz;
  // each state write re-rendered the canvas, so apply at most once per
  // animation frame using the latest pointer position.
  const moveRafRef = useRef<{
    raf: number | null;
    panDx: number;
    panDy: number;
    studs: { x: number; y: number } | null;
  }>({ raf: null, panDx: 0, panDy: 0, studs: null });
  function flushPointerMove() {
    const m = moveRafRef.current;
    if (m.raf !== null) {
      cancelAnimationFrame(m.raf);
      m.raf = null;
    }
    if (m.panDx !== 0 || m.panDy !== 0) {
      const st = useEditorStore.getState();
      st.setPan(st.panX + m.panDx, st.panY + m.panDy);
      m.panDx = 0;
      m.panDy = 0;
    }
    const studs = m.studs;
    m.studs = null;
    if (!studs) return;
    setMarquee((prev) => (prev ? { ...prev, x1: studs.x, y1: studs.y } : prev));
    const step = useEditorStore.getState().snapStepStuds;
    const cx = step > 0 ? Math.round(studs.x / step) * step : studs.x;
    const cy = step > 0 ? Math.round(studs.y / step) * step : studs.y;
    setRulerDraft((prev) => (prev ? { ...prev, curX: cx, curY: cy } : prev));
    // Venue preview follows the raw cursor (no grid snap, like desktop).
    setVenueDraft((prev) => (prev ? { ...prev, curX: studs.x, curY: studs.y } : prev));
  }
  function schedulePointerMove() {
    const m = moveRafRef.current;
    if (m.raf === null) m.raf = requestAnimationFrame(flushPointerMove);
  }
  useEffect(() => {
    const m = moveRafRef.current;
    return () => {
      if (m.raf !== null) cancelAnimationFrame(m.raf);
    };
  }, []);

  function handleStageMouseDown(e: KonvaEventObject<MouseEvent>) {
    const evt = e.evt as MouseEvent;

    // Middle-button pan — port of MapView.cpp:446-451 (desktop). Works on
    // any tool, on any target (brick or empty stage), so the user can
    // always reframe the canvas without changing tool.
    if (evt.button === 1) {
      evt.preventDefault();
      middlePanRef.current = { lastX: evt.clientX, lastY: evt.clientY };
      return;
    }

    // Right-click opens the context menu — don't clear selection or start marquee.
    if (evt.button === 2) return;

    // Only the select tool defers to whatever was clicked; ruler, venue and
    // paint tools act anywhere, over bricks too (desktop handles them before
    // item hit-testing, MapView.cpp:456-535).
    if (tool === 'select' && e.target !== e.target.getStage()) return;
    const studs = pointerStuds();
    if (!studs) return;

    if (tool === 'select') {
      // Empty-space click in select mode → start marquee. Shift/Ctrl
      // extends the current selection instead of replacing it (Qt
      // rubber band with a modifier).
      marqueeAdditiveRef.current = evt.shiftKey || evt.ctrlKey || evt.metaKey;
      if (!marqueeAdditiveRef.current) setSelection([]);
      setMarquee({ x0: studs.x, y0: studs.y, x1: studs.x, y1: studs.y });
      return;
    }
    if (tool === 'paint' || tool === 'erase') {
      if (isViewer) return;
      paintStrokeRef.current = new Set();
      doPaintStroke(studs.x, studs.y);
    }
    if ((tool === 'rulerLinear' || tool === 'rulerCircular') && !isViewer) {
      // Snap-step rounding on the start point matches the desktop
      // (MapView.cpp:461-466).
      const step = useEditorStore.getState().snapStepStuds;
      const sx = step > 0 ? Math.round(studs.x / step) * step : studs.x;
      const sy = step > 0 ? Math.round(studs.y / step) * step : studs.y;
      setRulerDraft({
        kind: tool === 'rulerLinear' ? 'linear' : 'circular',
        startX: sx,
        startY: sy,
        curX: sx,
        curY: sy,
      });
    }
    if ((tool === 'venueOutline' || tool === 'venueObstacle') && !isViewer) {
      // Venue vertices land exactly where clicked: desktop appends the raw
      // scene point with no grid snap (MapView.cpp:474-489).
      const sx = studs.x;
      const sy = studs.y;
      setVenueDraft((prev) =>
        prev
          ? { ...prev, pts: [...prev.pts, { x: sx, y: sy }], curX: sx, curY: sy }
          : { kind: tool === 'venueOutline' ? 'outline' : 'obstacle', pts: [{ x: sx, y: sy }], curX: sx, curY: sy }
      );
    }
  }

  function handleStageMouseMove(e: KonvaEventObject<MouseEvent>) {
    const evt = e.evt as MouseEvent;

    // Middle-button drag → translate pan. Mirrors MapView.cpp:649-657.
    if (middlePanRef.current) {
      const dx = evt.clientX - middlePanRef.current.lastX;
      const dy = evt.clientY - middlePanRef.current.lastY;
      middlePanRef.current = { lastX: evt.clientX, lastY: evt.clientY };
      moveRafRef.current.panDx += dx;
      moveRafRef.current.panDy += dy;
      schedulePointerMove();
      return;
    }

    const studs = pointerStuds();
    if (!studs) return;
    scheduleHudMouse(studs);
    // Continue the paint/erase stroke while the button is held.
    if ((tool === 'paint' || tool === 'erase') && paintStrokeRef.current && evt.buttons & 1) {
      doPaintStroke(studs.x, studs.y);
    }
    if (marquee || rulerDraft || venueDraft) {
      moveRafRef.current.studs = studs;
      schedulePointerMove();
    }
    // Always broadcast cursor so peers can see us — even when we're
    // panning or hovering empty space.
    dispatchCursorMove(studs.x, studs.y);
  }

  function handleStageMouseLeave() {
    dispatchCursorLeave();
    middlePanRef.current = null;
    paintStrokeRef.current = null;
    scheduleHudMouse(null);
  }

  /**
   * Paint or erase the area-cell under the given studs. Uses the topmost
   * Area layer (creating one if none exists). Mirrors desktop's
   * MapView.cpp:491-533 + AreaCommands `PaintAreaCellsCommand`.
   */
  function doPaintStroke(studX: number, studY: number) {
    if (!map) return;
    const stroke = paintStrokeRef.current;
    if (!stroke) return;
    const layerId = ensureAreaLayer(doc);
    // Find the cell size for this layer (default 8 if missing).
    const layer = map.layers.find((l) => l.id === layerId && l.type === 'area');
    const cellStuds =
      layer && layer.type === 'area' && layer.areaCellSize > 0 ? layer.areaCellSize : 8;
    const cx = Math.floor(studX / cellStuds);
    const cy = Math.floor(studY / cellStuds);
    const key = `${cx},${cy}`;
    if (stroke.has(key)) return;
    stroke.add(key);
    const color = useEditorStore.getState().paintColor;
    paintAreaCells(doc, layerId, [{ x: cx, y: cy, color: tool === 'erase' ? null : color }]);
  }

  function handleStageMouseUp(e: KonvaEventObject<MouseEvent>) {
    const evt = e.evt as MouseEvent;
    if (evt.button === 1 && middlePanRef.current) {
      middlePanRef.current = null;
      flushPointerMove();
      return;
    }
    paintStrokeRef.current = null;
    // Pending (not yet rendered) pointer move: the marquee must commit
    // against the final pointer position, not the last painted frame.
    const pendingStuds = moveRafRef.current.studs;
    flushPointerMove();

    // Commit a ruler draft if one is active. Snap end point to grid.
    if (rulerDraft) {
      const step = useEditorStore.getState().snapStepStuds;
      const studs = pointerStuds() ?? { x: rulerDraft.curX, y: rulerDraft.curY };
      const ex = step > 0 ? Math.round(studs.x / step) * step : studs.x;
      const ey = step > 0 ? Math.round(studs.y / step) * step : studs.y;
      const dx = ex - rulerDraft.startX;
      const dy = ey - rulerDraft.startY;
      // Skip degenerate zero-length drags (e.g. user clicked without drag).
      if (Math.hypot(dx, dy) >= 0.5) {
        const layerId = ensureRulerLayer(doc);
        if (rulerDraft.kind === 'linear') {
          addLinearRuler(
            doc,
            layerId,
            { x: rulerDraft.startX, y: rulerDraft.startY },
            { x: ex, y: ey },
          );
        } else {
          addCircularRuler(
            doc,
            layerId,
            { x: rulerDraft.startX, y: rulerDraft.startY },
            Math.hypot(dx, dy),
          );
        }
      }
      setRulerDraft(null);
    }

    if (!marquee) return;
    const finalMarquee = pendingStuds ? { ...marquee, x1: pendingStuds.x, y1: pendingStuds.y } : marquee;
    // Commit selection across EVERY visible brick layer — matches the
    // desktop's `MapView::mouseReleaseEvent` rubber-band, which calls
    // `QGraphicsView::mouseReleaseEvent` and lets Qt's scene selection
    // pick from every brick item regardless of layer.
    //
    // Hidden layers are skipped so the user can't accidentally select
    // bricks they can't see; the brick z-order across layers doesn't
    // affect the result. Each brick is tested by its rotated shape, like
    // Qt's IntersectsItemShape rubber band (render/marqueeMath.ts).
    //
    // Rulers, anchored labels and text cells in the band join the
    // selection too (mixed selection, like desktop's scene selection).
    if (map) {
      const ids: string[] = [];
      for (const layer of map.layers) {
        if (layer.type !== 'brick' || !layer.visible) continue;
        ids.push(...bricksInMarquee(finalMarquee, layer.bricks, brickSpriteStuds));
      }
      const sc = readSidecarFromDoc(doc);
      let anno = annotationsInMarquee(finalMarquee, map, sc?.anchoredLabels ?? [], sc?.modules ?? [], zoom);
      let bricks = ids;
      if (marqueeAdditiveRef.current) {
        const st = useEditorStore.getState();
        bricks = [...new Set([...st.selection, ...ids])];
        anno = mergeAnno(st.annoSelection, anno);
      }
      useEditorStore.getState().setMixedSelection(bricks, anno);
    }
    marqueeAdditiveRef.current = false;
    setMarquee(null);
  }

  // ---------------------------------------------------------------------
  // Clipboard — port of MapViewClipboard.cpp (29-132).
  // ---------------------------------------------------------------------

  async function copySelection(): Promise<void> {
    if (selection.length === 0 || !map) return;
    const sel = new Set(selection);
    const entries: ClipboardEntry[] = [];
    // Walk every brick layer in declaration order so within-layer
    // z-order survives copy/paste — same as desktop's
    // MapViewClipboard.cpp:42-49.
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (!sel.has(b.id)) continue;
        entries.push({
          sourceLayerName: layer.name,
          brick: {
            partNumber: b.partNumber,
            displayArea: { ...b.displayArea },
            orientation: b.orientation,
            altitude: b.altitude,
            activeConnectionPointIndex: b.activeConnectionPointIndex,
          },
        });
      }
    }
    await writeBricksToClipboard(entries);
  }

  async function cutSelection(): Promise<void> {
    await copySelection();
    if (selection.length === 0) return;
    deleteBricksAcrossLayers(doc, selectionByLayer());
    setSelection([]);
  }

  /** The selection's brick ids grouped by the layer that holds them. */
  function selectionByLayer(): Map<string, string[]> {
    return map ? bricksByLayer(map, selection) : new Map();
  }

  /**
   * Delete the whole mixed selection — bricks on any layer, rulers,
   * labels and text cells — as one undo step (MapView.cpp:2108-2179).
   */
  function deleteSelection(): void {
    if (!map || selection.length + annoCount(annoSelection) === 0) return;
    deleteMixedSelection(doc, map, selection, annoSelection);
    setSelection([]);
  }

  async function pasteAtCursor(): Promise<void> {
    const entries = await readBricksFromClipboard();
    if (!entries || entries.length === 0) return;
    if (!map) return;

    // Translate the group to land its centre under the cursor (or stage
    // centre if the cursor is off-stage). Mirrors MapViewClipboard.cpp:62-72.
    const target = pointerStuds() ?? {
      x: width / 2 / 8,
      y: height / 2 / 8,
    };
    let cx = 0;
    let cy = 0;
    for (const e of entries) {
      cx += e.brick.displayArea.x + e.brick.displayArea.width / 2;
      cy += e.brick.displayArea.y + e.brick.displayArea.height / 2;
    }
    cx /= entries.length;
    cy /= entries.length;
    const dx = target.x - cx;
    const dy = target.y - cy;

    // Group entries by source-layer name; find or create a brick layer
    // with that name in the current map.
    const byLayerName = new Map<string, ClipboardEntry[]>();
    const layerOrder: string[] = [];
    for (const entry of entries) {
      const key = entry.sourceLayerName || 'Bricks';
      if (!byLayerName.has(key)) {
        byLayerName.set(key, []);
        layerOrder.push(key);
      }
      byLayerName.get(key)!.push(entry);
    }

    const newIds: string[] = [];
    for (const name of layerOrder) {
      const targetLayerId = findOrCreateBrickLayerByName(name);
      if (!targetLayerId) continue;
      const bricks = byLayerName.get(name)!.map((e) => ({
        partNumber: e.brick.partNumber,
        displayArea: { ...e.brick.displayArea },
        orientation: e.brick.orientation,
        altitude: e.brick.altitude,
      }));
      const ids = insertBricks(doc, targetLayerId, bricks, { dx, dy });
      newIds.push(...ids);
    }
    if (newIds.length > 0) setSelection(newIds);
  }

  async function duplicateSelection(): Promise<void> {
    await copySelection();
    // Paste in-place + 1-stud offset (matches the previous Ctrl+D
    // behaviour while still going through the clipboard so cross-tab
    // duplicate works).
    // Each copy lands on its source brick's own layer (desktop pastes by
    // source layer — MapViewClipboard.cpp:74-110), in one undo step.
    if (!map) return;
    const sel = new Set(selection);
    const perLayer = new Map<string, Parameters<typeof insertBricks>[2]>();
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      const bricks = layer.bricks
        .filter((b) => sel.has(b.id))
        .map((b) => ({
          partNumber: b.partNumber,
          displayArea: { ...b.displayArea },
          orientation: b.orientation,
          altitude: b.altitude,
        }));
      if (bricks.length > 0) perLayer.set(layer.id, bricks);
    }
    const ids = insertBricksAcrossLayers(doc, perLayer, { dx: 1, dy: 1 });
    if (ids.length > 0) setSelection(ids);
  }

  /**
   * Find a brick layer by name; if none exists, create one. Mirrors
   * MapViewClipboard.cpp:93-104. Returns null only when the doc isn't
   * a brick-layer-capable map yet.
   */
  function findOrCreateBrickLayerByName(name: string): string | null {
    if (!map) return null;
    for (const layer of map.layers) {
      if (layer.type === 'brick' && layer.name === name) return layer.id;
    }
    // No matching layer — fall back to ensureBrickLayer (creates a
    // generic Bricks layer). This loses the original name but is the
    // safest behaviour without a "rename layer" mutation.
    return ensureBrickLayer(doc);
  }

  /**
   * Shared place commit, used by the place tool AND by the drag-from-
   * parts-panel drop handler. Sprite-aware sizing + snap-to-connection
   * + grid fallback. For `.set` (group) parts this expands the set
   * into one brick per subpart — port of MapView.cpp:1279-1360.
   */
  async function placePartAt(meta: PartWire, studX: number, studY: number) {
    // Group / set placement — expand into individual bricks at the
    // subpart-relative offsets the .set.xml declares. Single Yjs
    // transaction so undo unwinds the whole expansion.
    if (meta.kind === 'group' && meta.subparts.length > 0) {
      await placeSetAt(meta, studX, studY);
      return;
    }

    // Sprite-aware sizing. Load the GIF/PNG (cached), then derive stud
    // size as `naturalSize / pxPerStud` — matches the desktop's
    // SceneBuilder. Fall back to 16x16 studs if the sprite is missing
    // (rare; usually means the part XML lists no spritePath).
    let widthStuds = 16;
    let heightStuds = 16;
    const spriteUrl = spriteUrlFor(meta);
    if (spriteUrl) {
      try {
        const img = await ensureSprite(spriteUrl);
        widthStuds = img.naturalWidth / meta.pxPerStud;
        heightStuds = img.naturalHeight / meta.pxPerStud;
      } catch {
        // Use the default; the brick still places, just sized 16x16.
      }
    }

    // Selection-anchor snap: if exactly one brick is selected and it has
    // a free connection compatible with the new part, lock onto that
    // connection. Takes priority over cursor-proximity snap. Port of
    // MapView::resolvePartPlacement lines 1147-1202 (MapView.cpp).
    let snapped = null as import('./snap').SnapResult | null;
    let anchorSnapResult = null as AnchorSnapResult | null;
    if (map && selection.length === 1 && meta.kind !== 'group') {
      for (const layer of map.layers) {
        if (layer.type !== 'brick') continue;
        const anchorBrick = layer.bricks.find((b) => b.id === selection[0]);
        if (!anchorBrick) continue;
        const anchorMeta = partsByKey.get(anchorBrick.partNumber.toLowerCase())
          ?? partsByKey.get(anchorBrick.partNumber.toLowerCase().split('.')[0] ?? '');
        if (anchorMeta) {
          anchorSnapResult = snapToAnchorBrick(anchorBrick, anchorMeta, meta, widthStuds, heightStuds);
          snapped = anchorSnapResult;
        }
        break;
      }
    }

    // Fallback: cursor-proximity connection snap, then grid snap.
    if (!snapped) {
      snapped = map
        ? snapPlacement(
            {
              part: meta,
              centreX: studX,
              centreY: studY,
              orientation: 0,
              width: widthStuds,
              height: heightStuds,
              snapStepStuds,
            },
            map,
            partsByKey,
          )
        : { centreX: studX, centreY: studY, snappedToConnection: false, newOrientation: null };
    }

    const layerId = resolveBrickLayerForPlacement();
    if (activeLayerId !== layerId) setActiveLayer(layerId);

    // `snapPlacement` returns the rotation-aligned centre when connection
    // snap fired (mirrors desktop's `rotationAlignedTranslationStuds` +
    // `newOrientation` from ConnectionSnap.cpp:149-152). When no snap
    // fired, `newOrientation` is null and we default to 0°.
    const placeOrientation = snapped.newOrientation ?? 0;

    // Determine which connection on the NEW brick was used for the snap,
    // and set its `nextConnexionPreference` as the active (outgoing) index.
    // This lets the NEXT chain click know which end is the free outgoing
    // end without waiting for the async connectivity worker to populate
    // connexions — matches desktop's synchronous rebuildScene + selection.
    let activeConnIdx = 0;
    if (anchorSnapResult !== null) {
      const usedConn = meta.connections[anchorSnapResult.newConnIndex];
      activeConnIdx = usedConn?.nextConnexionPreference ?? anchorSnapResult.newConnIndex;
      // If nextConnexionPreference points back to itself (or is absent),
      // fall back to the other connection (for simple 2-CP parts like tracks).
      if (activeConnIdx === anchorSnapResult.newConnIndex && meta.connections.length > 1) {
        activeConnIdx = anchorSnapResult.newConnIndex === 0 ? 1 : 0;
      }
    }

    const newId = placeBrick(doc, layerId, {
      // Desktop stores the FULL catalog key (e.g. "2865.8") as the
      // brick's partNumber — see MapView.cpp:1380 `b.partNumber = partKey`.
      // We were saving the bare meta.partNumber ("2865"), which works at
      // runtime via the lookup fallback but writes a divergent value to
      // disk on export. Use `meta.key` so .bbm round-trip is byte-clean.
      partNumber: meta.key,
      x: snapped.centreX - widthStuds / 2,
      y: snapped.centreY - heightStuds / 2,
      width: widthStuds,
      height: heightStuds,
      orientation: placeOrientation,
      activeConnectionPointIndex: activeConnIdx,
    });
    // Auto-select the placed brick so chain-placing snaps off it.
    // Port of MapView.cpp:1394-1408.
    setSelection([newId]);
  }

  /**
   * Place a `.set` group — port of MapView.cpp:1279-1360. The .set.xml
   * lists SubPartList children with local positions and angles; we
   * emit one brick per subpart positioned at
   *
   *   subCentre = setCentre + subpart.position    (rotated nothing —
   *               the position is already in set-local studs)
   *
   * NOTE: desktop also adds a `hullBboxOffsetStuds(subKey, angle)`
   * correction that aligns the IMAGE bbox centre with the HULL bbox
   * centre (MapView.cpp:1323-1325). The web port doesn't compute hulls
   * so it skips that correction; for symmetric track sets the result
   * is identical, but asymmetric rotated curves / switches may sit a
   * fraction of a stud off-centre. The sets are still connected and
   * snap correctly afterwards via `rebuildConnectivity`.
   *
   * Multi-brick placement is wrapped in `insertBricks` so undo unwinds
   * the whole set as one step.
   */
  async function placeSetAt(group: PartWire, studX: number, studY: number) {
    if (group.subparts.length === 0) return;
    const layerId = resolveBrickLayerForPlacement();
    if (activeLayerId !== layerId) setActiveLayer(layerId);

    const bricks: Array<{
      partNumber: string;
      displayArea: { x: number; y: number; width: number; height: number };
      orientation: number;
    }> = [];
    for (const sub of group.subparts) {
      const subMeta = partsByKey.get(sub.subKey.toLowerCase());
      // Default to a 2×2 placeholder if the subpart isn't catalogued.
      let wStuds = 2;
      let hStuds = 2;
      if (subMeta) {
        const url = spriteUrlFor(subMeta);
        if (url) {
          try {
            const img = await ensureSprite(url);
            wStuds = img.naturalWidth / subMeta.pxPerStud;
            hStuds = img.naturalHeight / subMeta.pxPerStud;
          } catch {
            /* missing sprite — keep 2x2 fallback */
          }
        }
      }
      // Normalise orientation to (-180, 180].
      let angle = sub.angle % 360;
      if (angle > 180) angle -= 360;
      if (angle <= -180) angle += 360;
      const cx = studX + sub.x;
      const cy = studY + sub.y;
      bricks.push({
        partNumber: subMeta ? subMeta.key : sub.subKey.toLowerCase(),
        displayArea: { x: cx - wStuds / 2, y: cy - hStuds / 2, width: wStuds, height: hStuds },
        orientation: angle,
      });
    }
    const newIds = insertBricks(doc, layerId, bricks, { dx: 0, dy: 0 });
    if (newIds.length > 0) setSelection(newIds);
  }

  // Keep the imperative "place at view center" handle fresh every render
  // so the PartsPanel's click always uses the latest pan/zoom/size.
  // Port of MapView::addPartAtViewCenter (MapView.cpp:1279-1360).
  placeAtCenterRef.current = (meta: PartWire) => {
    if (isViewer) return;
    // Compute the world-stud coords of the canvas centre.
    const centreStudX = pxToStud((width / 2 - panX) / zoom);
    const centreStudY = pxToStud((height / 2 - panY) / zoom);
    void placePartAt(meta, centreStudX, centreStudY);
  };

  // Keep the export-image handle fresh (needs stageRef).
  // Port of MainWindowMenus.cpp:97-201 — saves the canvas as a PNG.
  // Renders the whole map (content bounds + margin), not the viewport.
  exportImageRef.current = {
    render: ({ pixelRatio, transparent, size, antialias, watermark, regionStuds }) => {
      const stage = stageRef.current;
      if (!stage || !map) return null;
      return renderMapToCanvas(stage, map, readSidecarFromDoc(doc), {
        pixelRatio,
        transparent,
        ...(size ? { size } : {}),
        ...(antialias !== undefined ? { antialias } : {}),
        ...(regionStuds ? { regionStuds } : {}),
        hudLayer: hudLayerRef.current,
        // Per-export option, desktop's "Embed general-info watermark".
        ...(watermark ? { watermark: watermarkText(map) } : {}),
      });
    },
    region: () => (map ? exportRegionStuds(map, readSidecarFromDoc(doc)) : null),
    sceneSize: () => (map ? exportSceneSize(map, readSidecarFromDoc(doc)) : null),
  };

  // The Stage's own size (not a window estimate): World labels and
  // Insert Text land under its centre (mapToScene(viewport centre)).
  function stageCentreStuds(): { x: number; y: number } {
    const st = stageRef.current;
    return viewCentreStuds({ width: st?.width() ?? width, height: st?.height() ?? height });
  }

  canvasActionsRef.current = {
    cut: () => void cutSelection(),
    copy: () => void copySelection(),
    paste: () => void pasteAtCursor(),
    delete: () => deleteSelection(),
    // Toolbar Rotate CCW / CW and Send to Back / Bring to Front
    // (MainWindow.cpp:733-742) — same actions as R / Shift+R and
    // Ctrl+Shift+[ / ].
    rotate: (cw) => {
      if (isViewer || selection.length === 0) return;
      rotateBricksAboutCentroid(doc, selectionByLayer(), cw ? rotationStepDegrees : -rotationStepDegrees);
    },
    reorder: (to) => {
      if (isViewer || selection.length === 0) return;
      reorderBricks(doc, selection, to);
    },
    // View ▸ Zoom In / Zoom Out / Fit (MainWindowMenus.cpp:493-503).
    zoom: (factor) => {
      const live = useEditorStore.getState().zoom;
      useEditorStore.getState().zoomAround(live * factor, width / 2, height / 2);
    },
    fit: () => void fitToContent(),
    // Insert ▸ Text... at the view centre (MapView::addTextAtViewCenter).
    insertText: () => {
      if (isViewer) return;
      setAddTextAt(stageCentreStuds());
      setShowAddText(true);
    },
    viewCentre: () => stageCentreStuds(),
  };

  if (!map) return <EmptyDoc />;
  const stageNode = (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={panX}
      y={panY}
      scaleX={zoom}
      scaleY={zoom}
      // No stage-level drag. Pan is middle-click only — matches desktop
      // MapView.cpp:446-451 + 649-657. Letting Konva drag the stage
      // would (a) hijack click+drag on bricks (their onDragEnd would
      // be ignored), and (b) bubble the brick's release coords up to
      // setPan, snapping the camera to wherever the brick landed.
      draggable={false}
      onWheel={(e) => {
        e.evt.preventDefault();
        // Wheel = zoom only, anchored under the cursor. Mirrors desktop
        // MapView::wheelEvent (MapView.cpp:354-390) + AnchorUnderMouse
        // (MapView.cpp:89): see wheelZoomStep.
        //
        // High-res trackpads emit wheel events at >60 Hz; processing
        // each one synchronously with a Yjs+catalog re-projection makes
        // the zoom feel choppy. Accumulate deltaY and apply once per
        // animation frame — same final zoom factor, far fewer renders.
        const stage = stageRef.current;
        if (!stage) return;
        const ptr = stage.getPointerPosition();
        if (!ptr) return;
        if (e.evt.deltaY === 0) return;

        const acc = zoomAccumRef.current;
        acc.deltaY += e.evt.deltaY;
        acc.ptrX = ptr.x;
        acc.ptrY = ptr.y;
        if (acc.raf !== null) return;

        acc.raf = requestAnimationFrame(() => {
          const a = zoomAccumRef.current;
          a.raf = null;
          if (a.deltaY === 0) return;
          const step = wheelZoomStep(a.deltaY, useEditorStore.getState().wheelZoomFactor);
          a.deltaY = 0;
          // Read the live zoom from the store at apply-time, not from
          // the closure — by now multiple frames may have elapsed.
          const live = useEditorStore.getState().zoom;
          useEditorStore.getState().zoomAround(live * step, a.ptrX, a.ptrY);
        });
      }}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onMouseLeave={handleStageMouseLeave}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        if (isViewer) return;
        if (tool === 'venueOutline' || tool === 'venueObstacle') {
          finishVenueDraft();
          return;
        }
        const stage = stageRef.current;
        if (!stage) return;
        const ptr = stage.getPointerPosition();
        if (!ptr) return;
        const studX = pxToStud((ptr.x - panX) / zoom);
        const studY = pxToStud((ptr.y - panY) / zoom);
        // Detect if any brick is under the cursor — if none, clicking on
        // empty canvas. Mirrors MapViewContextMenu.cpp:83-89 logic.
        const shapes = stage.getAllIntersections(ptr);
        const onBrick = shapes.some((s) => {
          const name = s.name?.() ?? '';
          return name.startsWith('brick-') || s.getAncestors?.().some?.((a: Konva.Node) => a.name?.()?.startsWith('brick-'));
        });
        // Detect text cell under cursor by AABB hit-test on the map.
        let textCellRef: TextCellRef | null = null;
        if (map) {
          outer: for (const layer of map.layers) {
            if (layer.type !== 'text' || !layer.visible) continue;
            for (let i = 0; i < layer.textCells.length; i++) {
              const cell = layer.textCells[i]!;
              const { x, y, width, height } = cell.displayArea;
              if (studX >= x && studX <= x + width && studY >= y && studY <= y + height) {
                textCellRef = { layerId: layer.id, cellIndex: i, cell };
                break outer;
              }
            }
          }
        }
        // Detect ruler item under cursor by AABB hit-test on displayArea.
        let rulerRef: { item: import('@cld/model').RulerItem; layerId: string } | null = null;
        if (map) {
          outerR: for (const layer of map.layers) {
            if (layer.type !== 'ruler' || !layer.visible) continue;
            for (const item of layer.rulerItems) {
              const { x, y, width, height } = item.displayArea;
              if (studX >= x && studX <= x + width && studY >= y && studY <= y + height) {
                rulerRef = { item, layerId: layer.id };
                break outerR;
              }
            }
          }
        }
        // Detect which brick (if any) is under the cursor by AABB hit-test.
        let brickIdUnderCursor: string | null = null;
        if (map && onBrick) {
          outerB: for (const layer of map.layers) {
            if (layer.type !== 'brick' || !layer.visible) continue;
            for (const b of layer.bricks) {
              const { x, y, width, height } = b.displayArea;
              if (studX >= x && studX <= x + width && studY >= y && studY <= y + height) {
                brickIdUnderCursor = b.id;
                break outerB;
              }
            }
          }
        }
        // Determine click position in client (viewport) coords for the
        // overlay div. getPointerPosition() is stage-local; convert.
        const rect = stage.container().getBoundingClientRect();
        setCtxMenu({ x: rect.left + ptr.x, y: rect.top + ptr.y, studX, studY, onBrick, textCellRef, rulerRef, brickIdUnderCursor });
      }}
      onTouchStart={handleStageMouseDown as unknown as (e: KonvaEventObject<TouchEvent>) => void}
    >
      {/* Layer 1 — mostly-static background: grid, background image,
          venue outline, paint areas, electric circuits. Changing any of
          these redraws only this one canvas. Hit-testing is only enabled
          in editor mode (matching the venue overlay's own listening flag
          below) so double-click-to-edit on the venue outline works —
          Konva ANDs `listening` down the ancestor chain, so a hard
          `listening={false}` here would permanently defeat the child
          Group's `listening={!isViewer}`. */}
      <KonvaLayer listening={!isViewer} perfectDrawEnabled={false}>
        {/* View-only (desktop paints it in drawBackground): hidden on export. */}
        <Group name={EXPORT_HIDE} listening={false}>
          <GridLayer
            map={map}
            zoom={zoom}
            viewport={{
              studXMin: pxToStud(-panX / zoom),
              studYMin: pxToStud(-panY / zoom),
              studXMax: pxToStud((width - panX) / zoom),
              studYMax: pxToStud((height - panY) / zoom),
            }}
          />
        </Group>
        <BackgroundImageLayer doc={doc} />
        <Group listening={!isViewer}>
          {isViewer
            ? <VenueOverlay venue={readSidecarFromDoc(doc)?.venue ?? null} labelFontPx={venueLabelPx} />
            : <VenueOverlay venue={readSidecarFromDoc(doc)?.venue ?? null} labelFontPx={venueLabelPx} onDoubleClick={onOpenVenueProps} />}
        </Group>
        <AreaLayers map={map} />
        {showElectricCircuits && map && (
          <ElectricCircuitLayer map={map} partsByKey={partsByKey} />
        )}
      </KonvaLayer>

      {/* Layer 2 — interactive content: bricks, text, rulers, labels.
          Hit-testing is enabled so clicks/drags on bricks and text work. */}
      <KonvaLayer perfectDrawEnabled={false}>
        <BrickLayer
          map={map}
          doc={doc}
          isViewer={isViewer}
          onEditBrick={onEditBrick}
        />
        <Group listening={!isViewer}>
          <TextLayers
            map={map}
            isViewer={isViewer}
            onEditText={(ref) => setEditingText(ref)}
            selectedKeys={selectedTextKeys}
            onSelectText={(key, additive) => selectAnno('texts', key, additive)}
          />
          <RulerLayers
            map={map}
            selectedRulerIds={selectedRulerIds}
            handleRulerId={selection.length === 0 && annoCount(annoSelection) === 1 ? selectedRulerId : null}
            onRulerSelect={(id, additive) => selectAnno('rulers', id, additive)}
            {...(!isViewer && tool === 'select' ? { drag: annoDrag } : {})}
            onRulerDoubleClick={(id) => {
              const layer = map.layers.find(
                (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === id),
              );
              if (!layer || layer.type !== 'ruler') return;
              const item = layer.rulerItems.find((r) => r.id === id);
              if (!item) return;
              selectAnno('rulers', id, false);
              setEditingRuler({ item, layerId: layer.id });
            }}
            onEndpointDrag={(rulerId, which, studX, studY, commit) => {
              const layer = map.layers.find(
                (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === rulerId),
              );
              if (!layer || layer.type !== 'ruler') return;
              let sx = studX;
              let sy = studY;
              if (commit && snapStepStuds > 0) {
                sx = Math.round(studX / snapStepStuds) * snapStepStuds;
                sy = Math.round(studY / snapStepStuds) * snapStepStuds;
              }
              moveRulerEndpoint(doc, layer.id, rulerId, which, { x: sx, y: sy });
            }}
          />
          {isViewer
            ? <AnchoredLabels map={map} labels={readSidecarFromDoc(doc)?.anchoredLabels ?? []} modules={readSidecarFromDoc(doc)?.modules ?? []} zoom={zoom} />
            : <AnchoredLabels
                map={map}
                labels={readSidecarFromDoc(doc)?.anchoredLabels ?? []}
                modules={readSidecarFromDoc(doc)?.modules ?? []}
                zoom={zoom}
                onDoubleClick={setEditingLabel}
                selectedIds={selectedLabelIds}
                onSelect={(id, additive) => selectAnno('labels', id, additive)}
                {...(tool === 'select' ? { drag: annoDrag } : {})}
              />}
          <ModuleOverlay
            map={map}
            modules={readSidecarFromDoc(doc)?.modules ?? []}
          />
        </Group>
      </KonvaLayer>

      {/* Layer 3 — HUD overlays (no hit-testing): drag ghost, marquee,
          snap ring, ruler/venue drafts, remote cursors. */}
      <KonvaLayer ref={hudLayerRef} listening={false} perfectDrawEnabled={false}>
        {dropPart && (() => {
          const part = partsByKey.get(dropPart.key.toLowerCase()) ?? null;
          if (!part || !map) {
            return <PlaceGhost part={part} cursorStudX={dropPart.studX} cursorStudY={dropPart.studY} />;
          }
          const ghostUrl = spriteUrlFor(part);
          const cached = ghostUrl ? getSpriteSync(ghostUrl) : null;
          const widthStuds = cached ? cached.naturalWidth / part.pxPerStud : 16;
          const heightStuds = cached ? cached.naturalHeight / part.pxPerStud : 16;
          const snapped = snapPlacement(
            { part, centreX: dropPart.studX, centreY: dropPart.studY, orientation: 0, width: widthStuds, height: heightStuds, snapStepStuds },
            map,
            partsByKey,
          );
          return <PlaceGhost part={part} cursorStudX={snapped.centreX} cursorStudY={snapped.centreY} />;
        })()}
        {dropModule && moduleDragRef.current?.ready && (() => {
          const batches = moduleDragRef.current.ready;
          const offset = moduleDropTranslation(
            batches,
            { x: dropModule.studX, y: dropModule.studY },
            snapStepStuds,
            map,
            partsByKey,
          );
          return <ModuleGhost batches={batches} offset={offset} partsByKey={partsByKey} />;
        })()}
        <MarqueeOverlay marquee={marquee} />
        <SnapRing />
        {rulerDraft && <RulerDraftPreview draft={rulerDraft} />}
        {venueDraft && <VenueDraftPreview draft={venueDraft} />}
        <RemoteCursors awareness={awareness} map={map} />
      </KonvaLayer>
    </Stage>
  );

  function commitAddText(r: TextDialogResult) {
    // Place at the current cursor (or stage centre if cursor isn't
    // over the canvas yet). `addTextCell` infers a stud-size box from
    // the requested font size so the renderer's probe-and-fit lands
    // somewhere reasonable.
    const target = addTextAt ?? pointerStuds() ?? viewCentreStuds({ width, height });
    setAddTextAt(null);
    const layerId = ensureTextLayer(doc);
    // Heuristic: 1 stud ≈ 8 px, so a 24-px font wants ~3 studs tall;
    // width is 0.6 × height per character.
    const heightStuds = Math.max(2, r.fontSize / 8);
    const widthStuds = Math.max(2, r.text.length * heightStuds * 0.6);
    const styleParts: string[] = [];
    if (r.isBold) styleParts.push('Bold');
    if (r.isItalic) styleParts.push('Italic');
    addTextCell(doc, layerId, {
      centreX: target.x,
      centreY: target.y,
      widthStuds,
      heightStuds,
      text: r.text,
      font: { family: r.fontFamily, size: r.fontSize, style: styleParts.join(',') || 'Regular' },
      fontColor: { kind: 'argb', argb: r.colorArgb },
      orientation: r.rotation,
    });
    setShowAddText(false);
  }

  return (
    <>
      {stageNode}
      <Suspense fallback={null}>
      {editing && (
        <EditBrickDialog
          brick={editing.brick}
          layerId={editing.layerId}
          doc={doc}
          meta={editing.meta}
          onClose={() => setEditing(null)}
        />
      )}
      {editingRuler && (
        <EditRulerDialog
          item={editingRuler.item}
          layerId={editingRuler.layerId}
          doc={doc}
          onClose={() => setEditingRuler(null)}
        />
      )}
      {showAddText && (
        <TextDialog
          onClose={() => {
            setShowAddText(false);
            setAddTextAt(null);
          }}
          onCommit={commitAddText}
        />
      )}
      {editingText && (
        <TextDialog
          initial={editingText.cell}
          onClose={() => setEditingText(null)}
          onDelete={() => {
            deleteTextCell(doc, editingText.layerId, editingText.cellIndex);
            setSelection([]);
            setEditingText(null);
          }}
          onCommit={(r) => {
            const styleParts: string[] = [];
            if (r.isBold) styleParts.push('Bold');
            if (r.isItalic) styleParts.push('Italic');
            editTextCellFull(doc, editingText.layerId, editingText.cellIndex, {
              text: r.text,
              font: { family: r.fontFamily, size: r.fontSize, style: styleParts.join(',') || 'Regular' },
              fontColor: { kind: 'argb', argb: r.colorArgb },
              orientation: r.rotation,
            });
            setEditingText(null);
          }}
        />
      )}
      {editingLabel && (
        <AddAnchoredLabelDialog
          doc={doc}
          defaultTargetId={null}
          initialLabel={editingLabel}
          onClose={() => setEditingLabel(null)}
        />
      )}
      </Suspense>
      {ctxMenu && !isViewer && (
        <CanvasContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          studX={ctxMenu.studX}
          studY={ctxMenu.studY}
          onBrick={ctxMenu.onBrick}
          selection={selection}
          map={map}
          doc={doc}
          activeLayerId={activeLayerId}
          undo={undo}
          onClose={() => setCtxMenu(null)}
          onCopy={() => void copySelection()}
          onCut={() => void cutSelection()}
          onPaste={() => void pasteAtCursor()}
          onDuplicate={() => void duplicateSelection()}
          onDelete={() => deleteSelection()}
          onRotateCCW={() => rotateBricksAboutCentroid(doc, selectionByLayer(), -rotationStepDegrees)}
          onRotateCW={() => rotateBricksAboutCentroid(doc, selectionByLayer(), rotationStepDegrees)}
          onBringToFront={() => {
            if (selection.length > 0) reorderBricks(doc, selection, 'front');
          }}
          onSendToBack={() => {
            if (selection.length > 0) reorderBricks(doc, selection, 'back');
          }}
          onGroup={() => groupBricksAcrossLayers(doc, selectionByLayer())}
          onUngroup={() => ungroupBricksAcrossLayers(doc, selectionByLayer())}
          onSelectConnected={() => {
            if (!map) return;
            const adj = buildConnectedAdj(map);
            const visited = new Set<string>(selection);
            const queue = [...selection];
            while (queue.length > 0) {
              const id = queue.shift()!;
              for (const nb of adj.get(id) ?? []) {
                if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
              }
            }
            setSelection([...visited]);
          }}
          textCellRef={ctxMenu.textCellRef}
          rulerRef={ctxMenu.rulerRef}
          brickIdUnderCursor={ctxMenu.brickIdUnderCursor}
          selectedRulerId={selectedRulerId}
          onAttachRuler={(which) => {
            if (!ctxMenu.brickIdUnderCursor || !selectedRulerId || !map) return;
            const layer = map.layers.find(
              (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === selectedRulerId),
            );
            if (!layer || layer.type !== 'ruler') return;
            attachRulerEndpoint(doc, layer.id, selectedRulerId, which, ctxMenu.brickIdUnderCursor);
          }}
          onEditText={(ref) => setEditingText(ref)}
          onAddTextHere={() => {
            // Prompt for the text first (desktop asks via its text dialog)
            // instead of dropping a placeholder "Text" cell.
            setAddTextAt({ x: ctxMenu.studX, y: ctxMenu.studY });
            setShowAddText(true);
          }}
          onProperties={() => {
            if (ctxMenu.textCellRef) {
              setEditingText(ctxMenu.textCellRef);
              return;
            }
            if (ctxMenu.rulerRef) {
              setEditingRuler(ctxMenu.rulerRef);
              return;
            }
            if (selection.length === 1 && map) {
              for (const layer of map.layers) {
                if (layer.type !== 'brick') continue;
                const b = layer.bricks.find((br) => br.id === selection[0]);
                if (b) {
                  const meta = partsByKey.get(b.partNumber.toLowerCase());
                  setEditing({ brick: b, layerId: layer.id, meta });
                  break;
                }
              }
            }
          }}
          onSaveModule={onSaveModule}
        />
      )}
      <ScaleBarHud zoom={zoom} />
    </>
  );
}

/**
 * Scale-bar HUD — fixed overlay in the bottom-right corner of the canvas.
 * Port of MapViewPaint.cpp:40-63 ("scale bar"). Shows a rounded-rect
 * bar whose width represents a round number of studs at the current zoom.
 * One stud = 8mm; displays in mm below 100 studs, m above.
 */
function ScaleBarHud({ zoom }: { zoom: number }) {
  // Target bar width: ~80 px at current zoom. Find the nearest "round"
  // stud count (1, 2, 5, 10, 20, 50, 100, …).
  const TARGET_PX = 80;
  const studsPerPx = 1 / (zoom * 8); // pxPerStud = 8 at zoom=1
  const targetStuds = TARGET_PX * studsPerPx;
  const magnitude = Math.pow(10, Math.floor(Math.log10(targetStuds)));
  const nice = [1, 2, 5, 10].map((f) => f * magnitude);
  const barStuds = nice.reduce((best, v) =>
    Math.abs(v - targetStuds) < Math.abs(best - targetStuds) ? v : best
  );
  const barPx = Math.round(barStuds * zoom * 8);
  const label =
    barStuds >= 125 ? `${(barStuds * 0.008).toFixed(0)} m`
    : barStuds >= 12.5 ? `${(barStuds * 8).toFixed(0)} cm`
    : `${(barStuds * 8).toFixed(0)} mm`;

  return (
    <div
      className="pointer-events-none absolute bottom-3 right-3 flex flex-col items-end gap-1"
      style={{ userSelect: 'none' }}
    >
      <span className="text-[10px] text-neutral-300 drop-shadow-sm">{label}</span>
      <div
        className="rounded-sm bg-neutral-200/80"
        style={{ width: barPx, height: 4 }}
      />
    </div>
  );
}

/**
 * Export the part list of a map as a CSV file (download). Port of
 * MainWindowFileIO.cpp:253-293. Aggregates brick counts by part number.
 */
function exportPartListCsv(map: import('@cld/model').BbmMap): void {
  const counts = new Map<string, { description: string; count: number }>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      const key = b.partNumber;
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { description: b.partNumber, count: 1 });
      }
    }
  }
  const rows = ['Part Number,Count'];
  for (const [key, { count }] of [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    rows.push(`${JSON.stringify(key)},${count}`);
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'parts.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Selection-aware right-click context menu — port of
 * MapViewContextMenu.cpp:39-244. Implemented as a fixed-position DOM
 * overlay (not a Konva layer) so it can hold interactive HTML elements
 * and receive keyboard focus for accessibility.
 */
function CanvasContextMenu({
  x, y, studX, studY, onBrick, selection, map, doc, activeLayerId, undo,
  textCellRef, onEditText, rulerRef, brickIdUnderCursor, selectedRulerId, onAttachRuler,
  onClose, onCopy, onCut, onPaste, onDuplicate, onDelete,
  onRotateCCW, onRotateCW, onBringToFront, onSendToBack,
  onGroup, onUngroup, onSelectConnected, onAddTextHere, onProperties, onSaveModule,
}: {
  x: number; y: number; studX: number; studY: number; onBrick: boolean;
  selection: string[]; map: import('@cld/model').BbmMap | null;
  doc: import('yjs').Doc; activeLayerId: string | null;
  undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  textCellRef: TextCellRef | null;
  rulerRef: { item: import('@cld/model').RulerItem; layerId: string } | null;
  brickIdUnderCursor: string | null;
  selectedRulerId: string | null;
  onAttachRuler: (which: 0 | 1) => void;
  onEditText: (ref: TextCellRef) => void;
  onClose: () => void;
  onCopy: () => void; onCut: () => void; onPaste: () => void; onDuplicate: () => void;
  onDelete: () => void; onRotateCCW: () => void; onRotateCW: () => void;
  onBringToFront: () => void; onSendToBack: () => void;
  onGroup: () => void; onUngroup: () => void; onSelectConnected: () => void;
  onAddTextHere: () => void; onProperties: () => void; onSaveModule: () => void;
}) {
  const hasSel = selection.length > 0;
  const singleSel = selection.length === 1;
  const multiSel = selection.length >= 2;

  // Close on outside click, scroll, or Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest('[data-ctx-menu]');
      if (!el) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    function onScroll() { onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [onClose]);

  // Clamp so menu stays inside the viewport.
  const menuW = 200;
  const menuH = 320;
  const left = Math.min(x, window.innerWidth - menuW - 4);
  const top = Math.min(y, window.innerHeight - menuH - 4);

  function item(label: string, handler: () => void, disabled = false) {
    return (
      <button
        key={label}
        disabled={disabled}
        onClick={() => { handler(); onClose(); }}
        className="w-full px-3 py-1 text-left text-xs hover:bg-neutral-700 disabled:opacity-35 disabled:cursor-default"
      >
        {label}
      </button>
    );
  }
  function sep(key: string) {
    return <div key={key} className="my-1 border-t border-neutral-700" />;
  }

  const entries: React.ReactNode[] = [];

  // Ruler-attach flow: when a ruler is selected and the cursor is on a
  // brick, offer Attach Endpoint 1 / 2 (and Centre for circular).
  // Mirrors MapViewContextMenu.cpp:116-158.
  if (selectedRulerId && brickIdUnderCursor) {
    const selRuler = map?.layers
      .find((l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === selectedRulerId));
    const rulerItem = selRuler?.type === 'ruler'
      ? selRuler.rulerItems.find((r) => r.id === selectedRulerId)
      : undefined;
    if (rulerItem) {
      if (rulerItem.kind === 'linear') {
        entries.push(item('Attach Endpoint 1 to this brick', () => onAttachRuler(0)));
        entries.push(item('Attach Endpoint 2 to this brick', () => onAttachRuler(1)));
      } else {
        entries.push(item('Attach Centre to this brick', () => onAttachRuler(0)));
      }
      entries.push(sep('sa'));
    }
  }

  if (textCellRef) {
    entries.push(item('Edit Text…', () => onEditText(textCellRef)));
    entries.push(item('Properties…', () => onEditText(textCellRef)));
    entries.push(sep('s0'));
  } else if (rulerRef) {
    entries.push(item('Properties…', onProperties));
    entries.push(sep('s0'));
  } else if (singleSel && onBrick) {
    entries.push(item('Properties…', onProperties));
    entries.push(sep('s0'));
  }

  if (hasSel) {
    entries.push(item('Rotate CCW', onRotateCCW));
    entries.push(item('Rotate CW', onRotateCW));
    entries.push(sep('s1'));
    entries.push(item('Bring to Front', onBringToFront));
    entries.push(item('Send to Back', onSendToBack));
    entries.push(sep('s2'));
    if (multiSel) entries.push(item('Group', onGroup));
    if (hasSel) entries.push(item('Ungroup', onUngroup, !hasSel));
    entries.push(item('Select Connected', onSelectConnected));
    entries.push(sep('s3'));
    entries.push(item('Save as Module…', onSaveModule));
    entries.push(sep('s3b'));
    entries.push(item('Cut', onCut));
    entries.push(item('Copy', onCopy));
    entries.push(item('Duplicate', onDuplicate));
    entries.push(sep('s4'));
    entries.push(item('Delete', onDelete));
    entries.push(sep('s5'));
  }

  entries.push(item('Paste', onPaste));
  entries.push(item('Add Text Here…', onAddTextHere));
  entries.push(sep('s6'));
  entries.push(item('Undo', undo.undo, !undo.canUndo));
  entries.push(item('Redo', undo.redo, !undo.canRedo));

  return (
    <div
      data-ctx-menu="1"
      style={{ position: 'fixed', left, top, zIndex: 9999, minWidth: menuW }}
      className="flex flex-col rounded-sm border border-neutral-700 bg-neutral-900 py-1 shadow-xl text-neutral-200"
    >
      {entries}
    </div>
  );
}

/**
 * Green ring drawn at the active connection-snap target during drag —
 * port of SelectionOverlay::paint snap-state branch (SelectionOverlay.cpp:42-46).
 * Driven by editor-store `liveSnap`.
 */
function SnapRing() {
  const live = useEditorStore((s) => s.liveSnap);
  if (!live) return null;
  return (
    <Circle
      x={live.studX * 8}
      y={live.studY * 8}
      radius={10}
      stroke="rgb(20, 180, 80)"
      strokeWidth={3}
      fill="rgba(80, 255, 120, 0.4)"
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/**
 * Header dropdown for re-showing hidden panels — minimal port of
 * desktop's View menu dock toggles (MainWindowMenus.cpp:505-516).
 * Always available, even when no panels are currently hidden, so the
 * affordance stays visible.
 */
const PANEL_TITLES: Record<string, string> = { parts: 'Parts', layers: 'Layers', usedparts: 'Used Parts', modules: 'Modules', modlibrary: 'Module Library', venuelibrary: 'Venue Library' };

/**
 * Renders a vertical stack of panels in one dock column, with:
 *   - a column-resize Resizer on the column's outer edge (caller
 *     supplies it so left/right docks can wire opposite math)
 *   - a row-resize Resizer between every pair of stacked panels
 *
 * Panel sizing rule: the LAST panel in the column eats the residual
 * height (`flex-1`). Earlier panels honour their persisted
 * `panelHeights[id]` if set; otherwise they fall back to a content
 * size with a soft cap. This matches the desktop's QSplitter "the
 * bottom panel takes whatever space is left" convention.
 */
function DockColumn({
  panels,
  renderPanel,
  gridColumn,
  panelHeights,
  onResizePanel,
  edge,
  edgeSide,
}: {
  panels: string[];
  renderPanel: (id: string) => React.ReactNode;
  gridColumn: string;
  panelHeights: Record<string, number>;
  onResizePanel: (panelId: string, clientY: number) => void;
  edge: React.ReactNode;
  edgeSide: 'start' | 'end';
}) {
  return (
    <div
      className="flex h-full flex-row overflow-hidden"
      style={{ gridColumn, gridRow: '2' }}
    >
      {edgeSide === 'start' && edge}
      <div className="flex h-full min-h-0 w-full flex-col">
        {panels.map((id, i) => {
          const isLast = i === panels.length - 1;
          const height = panelHeights[id];
          // Build the props with exactOptionalPropertyTypes-friendly
          // conditional spreads — `fixedHeightPx`/`onResize` only get
          // included when defined.
          const slotProps: {
            panelId: string;
            isLast: boolean;
            fixedHeightPx?: number;
            onResize?: (clientY: number) => void;
          } = { panelId: id, isLast };
          if (!isLast && typeof height === 'number') slotProps.fixedHeightPx = height;
          if (!isLast) {
            slotProps.onResize = (clientY) => onResizePanel(id, clientY);
          }
          return (
            <ResizableDockSlot key={id} {...slotProps}>
              {renderPanel(id)}
            </ResizableDockSlot>
          );
        })}
      </div>
      {edgeSide === 'end' && edge}
    </div>
  );
}

/**
 * Single slot in a dock column. Holds the panel content and (for non-
 * last slots) a row-axis Resizer at the bottom edge. The slot itself
 * captures its top offset via a ref so the row resizer can convert
 * the global clientY to a panel height.
 */
function ResizableDockSlot({
  panelId,
  isLast,
  fixedHeightPx,
  onResize,
  children,
}: {
  panelId: string;
  isLast: boolean;
  fixedHeightPx?: number;
  onResize?: (clientY: number) => void;
  children: React.ReactNode;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  return (
    <>
      <div
        ref={slotRef}
        data-panel-id={panelId}
        className={
          'flex w-full min-h-0 flex-col overflow-hidden ' +
          (fixedHeightPx !== undefined ? '' : 'flex-1')
        }
        style={fixedHeightPx !== undefined ? { height: `${fixedHeightPx}px`, flex: 'none' } : undefined}
      >
        {children}
      </div>
      {!isLast && onResize && (
        <Resizer
          axis="row"
          onResize={(clientY) => {
            const top = slotRef.current?.getBoundingClientRect().top ?? 0;
            onResize(clientY - top);
          }}
        />
      )}
    </>
  );
}

/**
 * Renders the sidecar background image as a Konva layer below all content.
 * Port of MapViewPaint.cpp:41-67: placed at its stored rect, or at native
 * size at the origin when there is none (see backgroundImageRectPx).
 */
function BackgroundImageLayer({ doc }: { doc: import('yjs').Doc }) {
  const bg = readSidecarFromDoc(doc)?.backgroundImage ?? null;
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!bg) { setImg(null); return; }
    const el = new window.Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = `${bg.url}?t=${Date.now()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bg?.url]);

  if (!bg || !img) return null;

  const r = backgroundImageRectPx(bg, { width: img.naturalWidth, height: img.naturalHeight });

  return (
    <Group listening={false}>
      <KonvaImage image={img} x={r.x} y={r.y} width={r.width} height={r.height} opacity={bg.opacity} listening={false} />
    </Group>
  );
}

/**
 * Live preview while drawing a linear/circular ruler. Renders the
 * pending shape AND a distance/radius readout right at the cursor so
 * the user knows the length before releasing — port of desktop's
 * preview path at MapView.cpp:824-875 and the addRulerLabel helper at
 * SceneBuilder.cpp:478-490.
 */
function RulerDraftPreview({
  draft,
}: {
  draft: { kind: 'linear' | 'circular'; startX: number; startY: number; curX: number; curY: number };
}) {
  const PX = 8;
  const ax = draft.startX * PX;
  const ay = draft.startY * PX;
  const bx = draft.curX * PX;
  const by = draft.curY * PX;
  if (draft.kind === 'linear') {
    const lenStuds = Math.hypot(draft.curX - draft.startX, draft.curY - draft.startY);
    const labelText = `${lenStuds.toFixed(1)} studs`;
    return (
      <Group>
        <Line
          points={[ax, ay, bx, by]}
          stroke="rgb(255,150,0)"
          strokeWidth={2}
          dash={[6, 4]}
          listening={false}
        />
        <Text
          x={(ax + bx) / 2 + 8}
          y={(ay + by) / 2 - 16}
          text={labelText}
          fontFamily="Arial"
          fontSize={14}
          fontStyle="bold"
          fill="rgb(255,180,0)"
          stroke="rgba(0,0,0,0.5)"
          strokeWidth={2}
          fillAfterStrokeEnabled
          listening={false}
        />
      </Group>
    );
  }
  // Circular
  const rStuds = Math.hypot(draft.curX - draft.startX, draft.curY - draft.startY);
  const rPx = rStuds * PX;
  const labelText = `r = ${rStuds.toFixed(1)} studs`;
  return (
    <Group>
      <Circle
        x={ax}
        y={ay}
        radius={rPx}
        stroke="rgb(255,150,0)"
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
        fillEnabled={false}
      />
      <Text
        x={ax + rPx + 6}
        y={ay - 8}
        text={labelText}
        fontFamily="Arial"
        fontSize={14}
        fontStyle="bold"
        fill="rgb(255,180,0)"
        stroke="rgba(0,0,0,0.5)"
        strokeWidth={2}
        fillAfterStrokeEnabled
        listening={false}
      />
    </Group>
  );
}

function VenueDraftPreview({
  draft,
}: {
  draft: { kind: 'outline' | 'obstacle'; pts: { x: number; y: number }[]; curX: number; curY: number };
}) {
  const PX = 8;
  const color = draft.kind === 'outline' ? 'rgb(100,200,255)' : 'rgb(255,160,60)';
  // All committed vertices + the live cursor vertex
  const all = [...draft.pts, { x: draft.curX, y: draft.curY }];
  if (all.length < 2) return null;
  // Flat points array for Konva Line
  const points = all.flatMap((p) => [p.x * PX, p.y * PX]);
  // Closing segment from cursor back to first vertex
  const first = draft.pts[0];
  const closingPoints = first
    ? [draft.curX * PX, draft.curY * PX, first.x * PX, first.y * PX]
    : null;
  return (
    <Group>
      <Line
        points={points}
        stroke={color}
        strokeWidth={2}
        dash={[6, 4]}
        listening={false}
        perfectDrawEnabled={false}
      />
      {closingPoints && (
        <Line
          points={closingPoints}
          stroke={color}
          strokeWidth={1}
          dash={[3, 6]}
          opacity={0.5}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {draft.pts.map((p, i) => (
        <Circle
          key={i}
          x={p.x * PX}
          y={p.y * PX}
          radius={4}
          fill={color}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
      <Text
        x={draft.curX * PX + 10}
        y={draft.curY * PX - 18}
        text={`${draft.pts.length} pts — Enter to commit, Esc to cancel`}
        fontFamily="Arial"
        fontSize={11}
        fill={color}
        listening={false}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}

/**
 * Status bar at the bottom of the editor — minimal port of
 * MainWindow.cpp:861-1014's permanent widgets.
 *   - Mouse position in studs (clears on canvas-leave)
 *   - Selection count
 *   - Zoom percentage
 */
function StatusBar({ gridSpan, status, venue, budgetLimits, budgetMap }: {
  gridSpan: number;
  status: import('./useLayoutDoc').SaveStatus;
  venue: import('@cld/bbm').Venue | null;
  budgetLimits: Map<string, number>;
  budgetMap: import('@cld/model').BbmMap | null;
}) {
  const studX = useEditorStore((s) => s.hudMouseStudX);
  const studY = useEditorStore((s) => s.hudMouseStudY);
  // Bricks plus selected rulers / labels / text cells (mixed selection).
  const selectionCount = useEditorStore((s) => s.selection.length + annoCount(s.annoSelection));
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const mapW = useEditorStore((s) => s.hudMapWidthStuds);
  const mapH = useEditorStore((s) => s.hudMapHeightStuds);
  const statusMessage = useEditorStore((s) => s.statusMessage);
  const dropTargetHint = useEditorStore((s) => s.dropTargetHint);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  // Surfaced here so the active layer is visible even when the Layers
  // panel is collapsed or scrolled out of view (issue #61).
  const activeLayer = activeLayerId ? budgetMap?.layers.find((l) => l.id === activeLayerId) : null;
  // The status bar re-renders on every HUD mouse update; keep the
  // venue validation and the budget tally off that path.
  const venueReadout = useMemo(
    () => venueStatus(venue, validateVenue(venue, budgetMap)),
    [venue, budgetMap],
  );
  const budgetOver = useMemo(() => {
    let over = 0;
    if (budgetMap && budgetLimits.size > 0) {
      const usage = new Map<string, number>();
      for (const layer of budgetMap.layers) {
        if (layer.type !== 'brick') continue;
        for (const b of layer.bricks) usage.set(b.partNumber, (usage.get(b.partNumber) ?? 0) + 1);
      }
      for (const [part, limit] of budgetLimits) {
        if (limit >= 0 && (usage.get(part) ?? 0) > limit) over++;
      }
    }
    return over;
  }, [budgetMap, budgetLimits]);
  // 1 stud = 8mm for standard LEGO; display in m when ≥100 studs
  function studDisplay(studs: number): string {
    if (studs >= 100) return `${(studs * 0.008).toFixed(1)} m`;
    return `${studs} st`;
  }
  const dirty = status.kind === 'reconnecting' || status.kind === 'error';
  return (
    <footer
      className="flex items-center justify-between gap-3 border-t border-neutral-800 bg-neutral-925 px-3 py-1 text-[11px] text-neutral-400"
      style={{ gridColumn: `span ${gridSpan}` }}
    >
      <div className="flex items-center gap-3">
        <span>Tool: <span className="text-neutral-200">{tool}{dirty ? ' *' : ''}</span></span>
        <span title="Active layer — new parts are placed here">
          Layer:{' '}
          <span className={activeLayer ? 'text-neutral-200' : 'text-neutral-600'}>
            {activeLayer ? activeLayer.name || 'unnamed' : 'none'}
          </span>
        </span>
        {dropTargetHint || statusMessage ? (
          <span className="text-blue-400 transition-opacity">{dropTargetHint ?? statusMessage}</span>
        ) : (
          <>
            <span>
              {studX !== null && studY !== null
                ? `Mouse: ${studX.toFixed(1)}, ${studY.toFixed(1)} st`
                : 'Mouse: —'}
            </span>
            {mapW !== null && mapH !== null && (
              <span title="Map bounding box">
                {studDisplay(mapW)} × {studDisplay(mapH)}
              </span>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {venueReadout && (
          // Desktop MainWindow.cpp:917-936: "Venue: OK" / "Venue: N issue(s)"
          // with the problems listed in the tooltip.
          <span
            data-testid="venue-status"
            title={venueReadout.tooltip}
            className={venueReadout.ok ? 'text-green-400' : 'font-semibold text-orange-400'}
          >
            {venueReadout.text}
          </span>
        )}
        {budgetLimits.size > 0 && (
          <span className={budgetOver > 0 ? 'text-red-400' : 'text-green-400'}
            title="Budget status">
            Budget: {budgetOver > 0 ? `${budgetOver} over` : 'OK'}
          </span>
        )}
        <span>
          {selectionCount === 0
            ? 'no selection'
            : `selected: ${selectionCount}`}
        </span>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
      </div>
    </footer>
  );
}

/**
 * Header dropdown combining Map, View and File-export actions.
 * Port of MainWindowMapMenu.cpp + MainWindowMenus.cpp View/File sections.
 */
function MapMenu({
  onGeneralInfo,
  onBackgroundColor,
  onBackgroundImage,
  onFind,
  onExportImage,
  onExportCsv,
  onSaveModule,
  onImportBbm,
  onCreateModule,
  onSaveAsSet,
  onInsertLabel,
  onInsertText,
  onZoomIn,
  onZoomOut,
  onFit,
  onDownloadBbm,
  onPreferences,
  onVenueProps,
  onVenueDimensions,
  onVenueClear,
  onVenueDrawOutline,
  onVenueDrawObstacle,
  onVenueSaveToLibrary,
  onVenueExportFile,
  onVenueLoadFromFile,
  onBudget,
}: {
  onGeneralInfo: () => void;
  onBackgroundColor: () => void;
  onBackgroundImage: () => void;
  onFind: () => void;
  onExportImage: () => void;
  onExportCsv: () => void;
  onSaveModule: () => void;
  onImportBbm: () => void;
  onCreateModule: () => void;
  onSaveAsSet: () => void;
  onInsertLabel: () => void;
  onInsertText: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onDownloadBbm: () => void;
  onPreferences: () => void;
  onVenueProps: () => void;
  onVenueDimensions: () => void;
  onVenueClear: () => void;
  onVenueDrawOutline: () => void;
  onVenueDrawObstacle: () => void;
  onVenueSaveToLibrary: () => void;
  onVenueExportFile: () => void;
  onVenueLoadFromFile: () => void;
  onBudget: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<React.CSSProperties>({});
  const showConnectionPoints = useEditorStore((s) => s.showConnectionPoints);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showBrickHulls = useEditorStore((s) => s.showBrickHulls);
  const showBrickElevation = useEditorStore((s) => s.showBrickElevation);
  const showRulerAttachPoints = useEditorStore((s) => s.showRulerAttachPoints);
  const alwaysShowConnections = useEditorStore((s) => s.alwaysShowConnections);
  const setShowConnectionPoints = useEditorStore((s) => s.setShowConnectionPoints);
  const setShowGrid = useEditorStore((s) => s.setShowGrid);
  const setShowBrickHulls = useEditorStore((s) => s.setShowBrickHulls);
  const setShowBrickElevation = useEditorStore((s) => s.setShowBrickElevation);
  const setShowRulerAttachPoints = useEditorStore((s) => s.setShowRulerAttachPoints);
  const setAlwaysShowConnections = useEditorStore((s) => s.setAlwaysShowConnections);
  const showModuleNames = useEditorStore((s) => s.showModuleNames);
  const showModuleFrames = useEditorStore((s) => s.showModuleFrames);
  const setShowModuleNames = useEditorStore((s) => s.setShowModuleNames);
  const setShowModuleFrames = useEditorStore((s) => s.setShowModuleFrames);

  const items: ({ label: string; action: () => void; checked?: undefined } | { label: string; action: () => void; checked: boolean })[] = [
    { label: 'General info...', action: onGeneralInfo },
    { label: 'Background colour...', action: onBackgroundColor },
    { label: 'Background image...', action: onBackgroundImage },
    { label: 'Find...  Ctrl+F', action: onFind },
    { label: '—', action: () => {} },
    { label: 'Venue → Draw Outline...', action: onVenueDrawOutline },
    { label: 'Venue → Draw Obstacle...', action: onVenueDrawObstacle },
    { label: 'Venue → Draw by Dimensions...', action: onVenueDimensions },
    { label: 'Venue → Edit Properties...', action: onVenueProps },
    { label: 'Venue → Save to Library...', action: onVenueSaveToLibrary },
    { label: 'Venue → Export as File...', action: onVenueExportFile },
    { label: 'Venue → Load from File...', action: onVenueLoadFromFile },
    { label: 'Venue → Clear', action: onVenueClear },
    { label: '—', action: () => {} },
    { label: 'Create Module from Selection...', action: onCreateModule },
    { label: 'Save Selection as Module...', action: onSaveModule },
    { label: 'Import .bbm as Module...', action: onImportBbm },
    { label: 'Save Selection as Set...', action: onSaveAsSet },
    { label: 'Insert Text...  Ctrl+T', action: onInsertText },
    { label: 'Insert Anchored Label...  Ctrl+L', action: onInsertLabel },
    { label: '—', action: () => {} },
    { label: 'Download .bbm', action: onDownloadBbm },
    { label: 'Export as Image...', action: onExportImage },
    { label: 'Export Part List (CSV)...', action: onExportCsv },
    { label: '—', action: () => {} },
    { label: 'Zoom In  Ctrl+=', action: onZoomIn },
    { label: 'Zoom Out  Ctrl+-', action: onZoomOut },
    { label: 'Fit to View  F', action: onFit },
    { label: 'Show Grid', action: () => setShowGrid(!showGrid), checked: showGrid },
    { label: 'Show Connection Points', action: () => setShowConnectionPoints(!showConnectionPoints), checked: showConnectionPoints },
    { label: 'Show Brick Hulls', action: () => setShowBrickHulls(!showBrickHulls), checked: showBrickHulls },
    { label: 'Show Brick Elevation', action: () => setShowBrickElevation(!showBrickElevation), checked: showBrickElevation },
    { label: 'Show Ruler Attach Points', action: () => setShowRulerAttachPoints(!showRulerAttachPoints), checked: showRulerAttachPoints },
    { label: 'Always Show Connections', action: () => setAlwaysShowConnections(!alwaysShowConnections), checked: alwaysShowConnections },
    { label: 'Show Module Names', action: () => setShowModuleNames(!showModuleNames), checked: showModuleNames },
    { label: 'Show Module Frames', action: () => setShowModuleFrames(!showModuleFrames), checked: showModuleFrames },
    { label: '—', action: () => {} },
    { label: 'Budget...', action: onBudget },
    { label: 'Preferences...  Ctrl+,', action: onPreferences },
  ];

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          setAnchor(dropdownAnchor(e.currentTarget));
          setOpen((v) => !v);
        }}
        className="rounded-sm border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
      >
        Map
      </button>
      {open && (
        <ul
          // Fixed, not absolute: the header row scrolls horizontally, which
          // would clip an absolutely positioned dropdown.
          className="fixed z-30 max-h-[calc(100vh-4rem)] w-52 overflow-y-auto rounded-sm border border-neutral-700 bg-neutral-900 text-xs shadow-sm"
          style={anchor}
          onClick={() => setOpen(false)}
        >
          {items.map((it, i) =>
            it.label === '—' ? (
              <li key={i} className="mx-2 my-0.5 border-t border-neutral-700" />
            ) : (
              <li key={it.label}>
                <button
                  onClick={it.action}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-neutral-800"
                >
                  <span className="w-3 text-center text-neutral-400">
                    {it.checked === true ? '✓' : it.checked === false ? '' : ''}
                  </span>
                  {it.label}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function LayersPanelHost({ doc, isViewer }: { doc: import('yjs').Doc; isViewer: boolean }) {
  // Re-renders on every Yjs update so layer ops (visibility, transparency,
  // rename, add, delete, move, name change) show immediately; the shared
  // cached projection means this costs no extra docToBbm.
  const map = useDocMap(doc);
  if (!map) return null;
  return <LayersPanel map={map} doc={doc} isViewer={isViewer} />;
}

function PanelsMenu({
  dock,
  onToggle,
}: {
  dock: import('./dockLayout').DockState;
  onToggle: (id: string, visible: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<React.CSSProperties>({});
  const allIds = Object.keys(PANEL_TITLES);
  return (
    <div className="relative">
      <button
        onClick={(e) => {
          setAnchor(dropdownAnchor(e.currentTarget));
          setOpen((v) => !v);
        }}
        className="rounded-sm border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
        title="Toggle panels"
      >
        Panels
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <ul className="fixed z-30 min-w-[168px] rounded-sm border border-neutral-700 bg-neutral-900 text-xs shadow-sm" style={anchor}>
            {allIds.map((id) => {
              const visible = dock.left.includes(id) || dock.right.includes(id) || dock.float.includes(id);
              return (
                <li key={id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-neutral-800">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => onToggle(id, e.target.checked)}
                      className="accent-blue-500"
                    />
                    {PANEL_TITLES[id] ?? id}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Paint colour swatch — port of desktop's MainWindow toolbar colour
 * button (MainWindow.cpp:578-845, "Paint colour" entry). Shows a
 * coloured square; clicking it pops up a native colour input. Stored
 * value is AARRGGBB hex; the input emits #RRGGBB so we keep the
 * existing alpha when changing.
 */
function PaintColorPicker() {
  const value = useEditorStore((s) => s.paintColor);
  const set = useEditorStore((s) => s.setPaintColor);
  // Strip alpha for the <input type=color> (which only handles RGB).
  const aa = value.slice(0, 2);
  const rgb = '#' + value.slice(2);
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-400" title="Paint colour">
      <span>Colour</span>
      <input
        type="color"
        value={rgb}
        onChange={(e) => {
          const v = e.target.value.replace(/^#/, '').toUpperCase();
          set(`${aa}${v}`);
        }}
        className="h-6 w-8 cursor-pointer rounded-sm border border-neutral-700 bg-transparent"
      />
    </label>
  );
}

/**
 * Snap-step dropdown — port of desktop's PreferencesDialog combo
 * (PreferencesDialog.cpp:117-129). Same value list, same labels:
 * `[off, 32, 16, 8, 4, 2, 1, 0.5]` studs. The setting is local-only
 * (per-tab) for now; PLAN.md TBD whether to persist via cookie/localStorage.
 */
function SnapPicker() {
  const value = useEditorStore((s) => s.snapStepStuds);
  const set = useEditorStore((s) => s.setSnapStep);
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-400" title="Grid snap step (studs)">
      <span>Snap</span>
      <select
        value={value}
        onChange={(e) => set(parseFloat(e.target.value))}
        className="rounded-sm border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
      >
        {SNAP_STEPS.map((s) => (
          <option key={s} value={s}>
            {s === 0 ? 'off' : s}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Rotation-step dropdown — port of desktop's rotation-step submenu
 * (MainWindowMenus.cpp:403-415). Controls R / Shift+R step.
 */
function RotationPicker() {
  const value = useEditorStore((s) => s.rotationStepDegrees);
  const set = useEditorStore((s) => s.setRotationStep);
  return (
    <label className="flex items-center gap-1 text-xs text-neutral-400" title="Rotation step (degrees)">
      <span>Rot</span>
      <select
        value={value}
        onChange={(e) => set(parseFloat(e.target.value))}
        className="rounded-sm border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
      >
        {ROTATION_STEPS.map((s) => (
          <option key={s} value={s}>
            {s}°
          </option>
        ))}
      </select>
    </label>
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
      <div className="max-w-sm rounded-sm border border-red-900 bg-red-950/30 p-4 text-sm">
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

function HeaderEditButtons({
  saveNow,
  canvasActionsRef,
}: {
  saveNow: () => Promise<void> | void;
  canvasActionsRef: React.MutableRefObject<CanvasActions | null>;
}) {
  const selection = useEditorStore((s) => s.selection);
  const annoTotal = useEditorStore((s) => annoCount(s.annoSelection));
  const hasSel = selection.length > 0;
  const btnCls = 'rounded-sm border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-default';
  const act = () => canvasActionsRef.current;
  return (
    <>
      <div className="h-4 w-px bg-neutral-700" />
      <button onClick={() => void saveNow()} title="Save (Ctrl+S)" className={btnCls}>
        Save
      </button>
      <div className="h-4 w-px bg-neutral-700" />
      <button onClick={() => act()?.cut()} disabled={!hasSel} title="Cut (Ctrl+X)" className={btnCls}>
        Cut
      </button>
      <button onClick={() => act()?.copy()} disabled={!hasSel} title="Copy (Ctrl+C)" className={btnCls}>
        Copy
      </button>
      <button onClick={() => act()?.paste()} title="Paste (Ctrl+V)" className={btnCls}>
        Paste
      </button>
      <button
        onClick={() => act()?.delete()}
        disabled={!hasSel && annoTotal === 0}
        title="Delete (Del)"
        className={btnCls + ' hover:bg-red-900/40'}
      >
        Delete
      </button>
      {/* Rotate + z-order, as on the desktop toolbar (MainWindow.cpp:733-742). */}
      <div className="h-4 w-px bg-neutral-700" />
      <button onClick={() => act()?.rotate(false)} disabled={!hasSel} title="Rotate CCW (R)" aria-label="Rotate CCW" className={btnCls}>
        ⟲
      </button>
      <button onClick={() => act()?.rotate(true)} disabled={!hasSel} title="Rotate CW (Shift+R)" aria-label="Rotate CW" className={btnCls}>
        ⟳
      </button>
      <button onClick={() => act()?.reorder('back')} disabled={!hasSel} title="Send to Back (Ctrl+Shift+[)" aria-label="Send to Back" className={btnCls + ' whitespace-nowrap'}>
        To back
      </button>
      <button onClick={() => act()?.reorder('front')} disabled={!hasSel} title="Bring to Front (Ctrl+Shift+])" aria-label="Bring to Front" className={btnCls + ' whitespace-nowrap'}>
        To front
      </button>
    </>
  );
}

/**
 * Build a brick-id adjacency map from connexion data.
 *
 * `Connexion.linkedTo` stores the **connexion id** of the partner (e.g.
 * `"brickA_0"`), NOT the brick id. We need a connexion-id → brick-id
 * lookup to resolve it, then build brick→brick edges.
 */
function buildConnectedAdj(map: import('@cld/model').BbmMap): Map<string, string[]> {
  // Pass 1: connexion id → brick id
  const connToBrick = new Map<string, string>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      for (const cx of b.connexions) {
        connToBrick.set(cx.id, b.id);
      }
    }
  }
  // Pass 2: build brick → [brick] adjacency
  const adj = new Map<string, string[]>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      for (const cx of b.connexions) {
        if (!cx.linkedTo) continue;
        const partnerId = connToBrick.get(cx.linkedTo);
        if (!partnerId || partnerId === b.id) continue;
        if (!adj.has(b.id)) adj.set(b.id, []);
        adj.get(b.id)!.push(partnerId);
      }
    }
  }
  return adj;
}

/** Serialise the local doc to .bbm in the browser and download it. */
async function downloadLocalBbm(doc: Y.Doc, title: string): Promise<void> {
  let file: { filename: string; type: string; data: Uint8Array };
  try {
    // Loaded on demand: the .bbm codec is its own chunk.
    const { writeBbm, writeSidecar } = await import('@cld/bbm');
    const xml = writeBbm(docToBbm(doc));
    // The sidecar (labels, modules, venue, background image) travels with
    // the .bbm, hashed like the server export so desktop sees no drift.
    const sidecar = readSidecarFromDoc(doc);
    const hash = sidecar ? await sha256Hex(xml) : undefined;
    const json = sidecar ? writeSidecar(sidecar, hash ? { bbmHashSha256: hash } : {}) : null;
    file = localBbmDownload(title, xml, json);
  } catch (e) {
    window.alert(`Could not build the .bbm: ${(e as Error).message}`);
    return;
  }
  const url = URL.createObjectURL(new Blob([file.data as BlobPart], { type: file.type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Keyboard / View-menu zoom step (desktop MainWindowMenus.cpp:493-498). */
const ZOOM_STEP = 1.2;

/** Imperative canvas actions shared with the header toolbar and menus. */
interface CanvasActions {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  delete: () => void;
  rotate: (cw: boolean) => void;
  reorder: (to: 'front' | 'back') => void;
  zoom: (factor: number) => void;
  fit: () => void;
  insertText: () => void;
  /** World-stud position under the centre of the canvas stage. */
  viewCentre: () => { x: number; y: number };
}
