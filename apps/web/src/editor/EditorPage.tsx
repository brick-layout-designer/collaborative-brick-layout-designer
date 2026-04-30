import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stage, Layer as KonvaLayer, Circle, Group, Image as KonvaImage, Line, Text } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { api, spriteUrlFor, type PartWire } from '../api';
import { useLayoutDoc } from './useLayoutDoc';
import { useYjsSnapshot } from './useYjsSnapshot';
import { useEditorStore, SNAP_STEPS, ROTATION_STEPS } from './editorStore';
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
import { docToBbm } from '@cld/ydoc';
import {
  addCircularRuler,
  addLinearRuler,
  addTextCell,
  attachRulerEndpoint,
  deleteBricks,
  deleteRulerItem,
  editTextCellFull,
  moveRulerEndpoint,
  ensureAreaLayer,
  ensureBrickLayer,
  ensureRulerLayer,
  ensureTextLayer,
  groupBricks,
  insertBricks,
  moveRulerItem,
  paintAreaCells,
  placeBrick,
  reorderBricks,
  rotateBricks,
  translateBricks,
  translateBricksAcrossLayers,
  ungroupBricks,
} from './mutations';
import { TextDialog, type TextDialogResult } from './TextDialog';
import { UsedPartsPanel } from './UsedPartsPanel';
import { readBricksFromClipboard, writeBricksToClipboard, type ClipboardEntry } from './clipboard';
import { pxToStud, studToPx } from './render/coords';
import { ensureSprite, getSpriteSync } from './render/spriteCache';
import { PlaceGhost } from './render/PlaceGhost';
import { snapPlacement, snapToAnchorBrick, type AnchorSnapResult } from './snap';
import { MarqueeOverlay, bricksInMarquee } from './render/MarqueeOverlay';
import { useUndoManager } from './useUndoManager';
import { useConnectivity } from './useConnectivity';
import { usePublishAwareness, dispatchCursorMove, dispatchCursorLeave } from './useAwareness';
import { PresencePanel } from './PresencePanel';
import { RemoteCursors } from './render/RemoteCursors';
import { ShareDialog } from '../layouts/ShareDialog';
import { InsertModuleDialog } from './InsertModuleDialog';
import { SaveModuleDialog } from './SaveModuleDialog';
import { EditBrickDialog } from './EditBrickDialog';
import { EditRulerDialog } from './EditRulerDialog';
import { GeneralInfoDialog } from './GeneralInfoDialog';
import { BackgroundColorDialog } from './BackgroundColorDialog';
import { BackgroundImageDialog } from './BackgroundImageDialog';
import { FindDialog } from './FindDialog';
import { PreferencesDialog } from './PreferencesDialog';
import { ImportBbmDialog } from './ImportBbmDialog';
import { ExportImageDialog } from './ExportImageDialog';
import { AddAnchoredLabelDialog } from './AddAnchoredLabelDialog';
import { SaveAsSetDialog } from './SaveAsSetDialog';
import { ModulesPanel } from './ModulesPanel';
import { ModuleLibraryPanel, MODULE_MIME } from './ModuleLibraryPanel';
import { VenuePropertiesDialog } from './VenuePropertiesDialog';
import { VenueDimensionsDialog } from './VenueDimensionsDialog';
import { BudgetDialog } from './BudgetDialog';
import { VenueLibraryPanel } from './VenueLibraryPanel';
import { VenueSaveLibraryDialog } from './VenueSaveLibraryDialog';

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
  const [budgetLimits, setBudgetLimits] = useState<Map<string, number>>(new Map());
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

  // Imperative clipboard / delete handle: Canvas writes the async
  // functions on every render so the header toolbar can call them
  // without lifting all clipboard state up to Editor.
  const clipboardRef = useRef<{
    cut: () => void;
    copy: () => void;
    paste: () => void;
    delete: () => void;
  } | null>(null);

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

  // Subscribe to ALL doc changes so the canvas re-renders.
  useYjsSnapshot(doc);

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
      const map = docToBbm(doc);
      const firstBrick = map.layers.find((l) => l.type === 'brick');
      if (!firstBrick) return;
      // If the current activeLayerId exists in this map, keep it.
      // Otherwise (stale id from another layout, or null), pick the first.
      const current = useEditorStore.getState().activeLayerId;
      const stillValid = current && map.layers.some((l) => l.id === current && l.type === 'brick');
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
    if (panelId === 'modules') return <ModulesPanel doc={doc} isViewer={isViewer} />;
    if (panelId === 'modlibrary') return <ModuleLibraryPanel doc={doc} isViewer={isViewer} />;
    if (panelId === 'venuelibrary') return <VenueLibraryPanel doc={doc} isViewer={isViewer} />;
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
                className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
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
                className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
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
          {!isViewer && (
            <HeaderEditButtons
              saveNow={saveNow}
              clipboardRef={clipboardRef}
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
                try { exportPartListCsv(docToBbm(doc)); } catch { /* not ready */ }
              }}
              onSaveModule={() => setShowSaveModule(true)}
              onImportBbm={() => setShowImportBbm(true)}
              onSaveAsSet={() => setShowSaveAsSet(true)}
              onInsertLabel={() => setShowAddLabel(true)}
              onPreferences={() => setShowPreferences(true)}
              onVenueProps={() => setShowVenueProps(true)}
              onVenueDimensions={() => setShowVenueDimensions(true)}
              onVenueClear={() => {
                if (!doc) return;
                if (!confirm('Remove the entire venue from this project?')) return;
                import('./mutations').then(({ setVenue }) => setVenue(doc, null));
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
                const json = JSON.stringify(venue, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${venue.name || 'venue'}.cld-venue`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              onVenueLoadFromFile={() => {
                if (!doc) return;
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.cld-venue,.json';
                input.onchange = () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  file.text().then((text) => {
                    try {
                      const venue = JSON.parse(text);
                      import('./mutations').then(({ setVenue: sv }) => sv(doc, venue));
                    } catch {
                      alert('Could not parse venue file.');
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
              className="rounded border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
              title="Insert a saved module"
            >
              Insert module
            </button>
          )}
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
        <Canvas doc={doc} awareness={awareness} isViewer={isViewer} saveNow={saveNow} status={status} placeAtCenterRef={placeAtCenterRef} exportImageRef={exportImageRef} clipboardRef={clipboardRef} undo={undo} onOpenVenueProps={() => setShowVenueProps(true)} />
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
        budgetMap={(() => { try { return doc ? docToBbm(doc) : null; } catch { return null; } })()}
      />

      {showInsertModule && (
        <InsertModuleDialog doc={doc} onClose={() => setShowInsertModule(false)} />
      )}
      {showSaveModule && (() => {
        try {
          const m = docToBbm(doc);
          const sel = useEditorStore.getState().selection;
          return (
            <SaveModuleDialog
              map={m}
              selection={sel}
              onClose={() => setShowSaveModule(false)}
              onSaved={(_id, title) => {
                setShowSaveModule(false);
                alert(`Module "${title}" saved.`);
              }}
            />
          );
        } catch {
          return null;
        }
      })()}
      {showGeneralInfo && (() => {
        try {
          const m = docToBbm(doc);
          return <GeneralInfoDialog map={m} doc={doc} onClose={() => setShowGeneralInfo(false)} />;
        } catch {
          return null;
        }
      })()}
      {showBackgroundColor && (() => {
        try {
          const m = docToBbm(doc);
          return (
            <BackgroundColorDialog
              current={m.backgroundColor}
              doc={doc}
              onClose={() => setShowBackgroundColor(false)}
            />
          );
        } catch {
          return null;
        }
      })()}
      {showBackgroundImage && (
        <BackgroundImageDialog
          layoutId={layoutId}
          doc={doc}
          onClose={() => setShowBackgroundImage(false)}
        />
      )}
      {showFind && (() => {
        try {
          const m = docToBbm(doc);
          return <FindDialog map={m} doc={doc} onClose={() => setShowFind(false)} />;
        } catch {
          return null;
        }
      })()}
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
      {showBudget && (() => {
        let budgetMap = null;
        try { budgetMap = doc ? docToBbm(doc) : null; } catch { /* not ready */ }
        return (
          <BudgetDialog
            map={budgetMap}
            limits={budgetLimits}
            onLimitsChange={setBudgetLimits}
            onClose={() => setShowBudget(false)}
          />
        );
      })()}
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
  clipboardRef,
  undo,
  onOpenVenueProps,
}: {
  doc: import('yjs').Doc;
  awareness: import('y-protocols/awareness').Awareness | null;
  isViewer: boolean;
  saveNow: () => Promise<void> | void;
  status: import('./useLayoutDoc').SaveStatus;
  placeAtCenterRef: React.MutableRefObject<((part: PartWire) => void) | null>;
  exportImageRef: React.MutableRefObject<import('./ExportImageDialog').ExportHandle | null>;
  clipboardRef: React.MutableRefObject<{ cut: () => void; copy: () => void; paste: () => void; delete: () => void } | null>;
  undo: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  onOpenVenueProps: () => void;
}) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const { width, height } = useViewportSize();
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
  const showExportWatermark = useEditorStore((s) => s.showExportWatermark);
  const showElectricCircuits = useEditorStore((s) => s.showElectricCircuits);
  const venueLabelPx = useEditorStore((s) => s.venueLabelPx);



  // External drag-from-Parts-panel state. While the user is dragging a
  // thumbnail over the canvas the panel emits a custom MIME (key) on
  // dragover; we render the same PlaceGhost as the place tool so the
  // user sees a live preview with snap-to-connection. Mirrors desktop
  // `MapView::dragMoveEvent` + `updateDragPreview` (MapView.cpp:1678-1761).
  const [dropPart, setDropPart] = useState<{ key: string; studX: number; studY: number } | null>(null);

  // Marquee state. Active while the user is dragging in select mode on
  // empty stage. Mouse-up commits the intersection to selection.
  const [marquee, setMarquee] = useState<import('./render/MarqueeOverlay').Marquee | null>(null);

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

  // Edit-AnchoredLabel dialog state — opened by double-click on a label.
  const [editingLabel, setEditingLabel] = useState<import('@cld/bbm').AnchoredLabel | null>(null);

  // Edit-Ruler dialog state — opened by double-click on a ruler item.
  // `selectedRulerId` drives the highlight halo in `RulerLayers`; the
  // pointer-down on a ruler updates it without opening the dialog so
  // the user can hit Delete/arrow-nudge with the ruler "selected".
  const [selectedRulerId, setSelectedRulerId] = useState<string | null>(null);
  const [editingRuler, setEditingRuler] = useState<
    { item: import('@cld/model').RulerItem; layerId: string } | null
  >(null);

  // Add-Text dialog state — opened by Ctrl+T.
  const [showAddText, setShowAddText] = useState(false);

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

  // Paint/erase stroke tracker — set of `${cx},${cy}` cells already
  // touched in the current stroke so we don't re-emit the same Yjs
  // change for cells the cursor crosses multiple times. Mirrors
  // desktop's `strokeCellsTouched_` (MapView.cpp:493-523).
  const paintStrokeRef = useRef<Set<string> | null>(null);

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

  // Push map bounding-box into the store so the StatusBar can show it
  // without prop-drilling. Runs whenever the map changes.
  const setHudMapBounds = useEditorStore((s) => s.setHudMapBounds);
  useMemo(() => {
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

  // Drag-from-Parts-panel → drop on canvas. The Stage's container <div>
  // receives native HTML5 drag events. We accept the custom MIME type
  // emitted by PartsPanel, render a live ghost via `dropPart` while
  // dragover, and commit a `placePartAt` on drop. Direct port of
  // MapView::dragEnterEvent / dragMoveEvent / dropEvent (lines 1659-2042).
  useEffect(() => {
    const stage = stageRef.current;
    const container = stage?.container();
    if (!container) return;
    const PART_MIME = 'application/x-cld-part';

    function clientToStuds(clientX: number, clientY: number): { x: number; y: number } | null {
      if (!stage) return null;
      const rect = container!.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      // Apply inverse of stage transform.
      return {
        x: pxToStud((px - panX) / zoom),
        y: pxToStud((py - panY) / zoom),
      };
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

    function onDragOver(e: DragEvent) {
      const dt = e.dataTransfer;
      if (!dt) return;
      // Quick MIME sniff — avoid hijacking unrelated drags.
      const types = Array.from(dt.types ?? []);
      const isModule = types.includes(MODULE_MIME);
      if (!isModule && !types.includes(PART_MIME) && !types.includes('text/plain')) return;
      e.preventDefault();
      dt.dropEffect = 'copy';
      if (isModule) return; // no ghost needed for module drops
      const studs = clientToStuds(e.clientX, e.clientY);
      if (!studs) return;
      const key = readPartKey(dt);
      // dragover on Firefox doesn't expose getData payloads — fall back
      // to the most-recently-stored key from a previous dragenter via
      // local state when missing.
      setDropPart((prev) => ({
        key: key || prev?.key || '',
        studX: studs.x,
        studY: studs.y,
      }));
    }

    function onDragLeave(_e: DragEvent) {
      setDropPart(null);
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      const dt = e.dataTransfer;
      setDropPart(null);

      // Module drop — fetch snapshot and insert bricks.
      const moduleIdRaw = dt?.getData(MODULE_MIME);
      const moduleId = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(moduleIdRaw ?? '')?.[1];
      if (moduleId) {
        // Relative URL — same-origin browser fetch, not a server-side request.
        // Path is /api/modules/<validated-uuid>/snapshot with no user-controlled host.
        const moduleSnapshotPath = `/api/modules/${moduleId}/snapshot` as const;
        const layerId = activeLayerId ?? ensureBrickLayer(doc);
        void (async () => {
          try {
            const res = await fetch(moduleSnapshotPath, { credentials: 'include' });
            if (!res.ok) return;
            const buf = await res.arrayBuffer();
            const moduleDoc = new Y.Doc();
            Y.applyUpdate(moduleDoc, new Uint8Array(buf));
            let bbmMap: ReturnType<typeof docToBbm>;
            try { bbmMap = docToBbm(moduleDoc); } catch { moduleDoc.destroy(); return; }
            moduleDoc.destroy();
            const bricks = bbmMap.layers
              .filter((l): l is Extract<typeof l, { type: 'brick' }> => l.type === 'brick')
              .flatMap((l) => l.bricks);
            if (bricks.length > 0) insertBricks(doc, layerId, bricks);
          } catch { /* silent */ }
        })();
        return;
      }

      const key = readPartKey(dt) || dropPart?.key || '';
      const studs = clientToStuds(e.clientX, e.clientY);
      if (!key || !studs) return;
      const meta = partsByKey.get(key.toLowerCase());
      if (!meta) return;
      void placePartAt(meta, studs.x, studs.y);
    }

    container.addEventListener('dragover', onDragOver);
    container.addEventListener('dragleave', onDragLeave);
    container.addEventListener('drop', onDrop);
    return () => {
      container.removeEventListener('dragover', onDragOver);
      container.removeEventListener('dragleave', onDragLeave);
      container.removeEventListener('drop', onDrop);
    };
    // `placePartAt` and `dropPart` close over the latest state via
    // setDropPart; we rebind whenever the canvas dimensions / map
    // change so the closure has fresh refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsByKey, panX, panY, zoom, doc, activeLayerId, map]);

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
    const z = Math.max(0.1, Math.min(8, fitZoom));
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

  // Canvas keyboard shortcuts — port of desktop MapView::keyPressEvent
  // (MapView.cpp:942-983) and MainWindowMenus.cpp shortcut bindings:
  //
  //   Escape                — cancel place / deselect
  //   Delete / Backspace    — delete selection                  (MapView.cpp:959)
  //   R                     — rotate CCW 90°                    (MapView.cpp:964, MainWindowMenus.cpp:423)
  //   Shift+R               — rotate CW 90°                     (MapView.cpp:964, MainWindowMenus.cpp:418)
  //   Arrow keys            — nudge selection by 1 stud         (MapView.cpp:970-980)
  //   Ctrl+A                — select all bricks in active layer (MainWindowMenus.cpp:359)
  //   Ctrl+Shift+A          — select none                       (MainWindowMenus.cpp:362)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      // Escape — works regardless of viewer state.
      if (e.key === 'Escape') {
        e.preventDefault();
        if (venueDraft) { setVenueDraft(null); return; }
        setSelection([]);
        setSelectedRulerId(null);
        setRulerDraft(null);
        return;
      }

      // Enter — commit venue-draw polygon (≥3 pts) or obstacle.
      if (e.key === 'Enter' && venueDraft && !isViewer) {
        e.preventDefault();
        const pts = venueDraft.pts;
        const kind = venueDraft.kind;
        if (pts.length >= 3 && doc) {
          void (async () => {
            const { setVenue: sv } = await import('./mutations');
            const existing = readSidecarFromDoc(doc);
            if (kind === 'outline') {
              const edges: import('@cld/bbm').VenueEdge[] = pts.map((pt, i) => ({
                kind: 0,
                doorWidthStuds: 0,
                label: '',
                poly: [pt, pts[(i + 1) % pts.length]!],
              }));
              const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
              const minX = Math.min(...xs), minY = Math.min(...ys);
              const maxX = Math.max(...xs), maxY = Math.max(...ys);
              const venue: import('@cld/bbm').Venue = {
                name: existing?.venue?.name ?? '',
                enabled: existing?.venue?.enabled ?? true,
                minWalkwayStuds: existing?.venue?.minWalkwayStuds ?? 0,
                bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
                edges,
                obstacles: existing?.venue?.obstacles ?? [],
              };
              sv(doc, venue);
            } else {
              const obstacle: import('@cld/bbm').VenueObstacle = { label: '', poly: pts };
              const base = existing?.venue ?? {
                name: '', enabled: true, minWalkwayStuds: 0,
                bounds: { x: 0, y: 0, w: 0, h: 0 }, edges: [], obstacles: [],
              };
              sv(doc, { ...base, obstacles: [...base.obstacles, obstacle] });
            }
          })();
        }
        setVenueDraft(null);
        useEditorStore.getState().setTool('select');
        return;
      }

      // Ctrl/Cmd + A / Shift+A — select-all / select-none.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        if (e.shiftKey) {
          setSelection([]);
        } else if (activeLayerId) {
          try {
            const m = docToBbm(doc);
            const layer = m.layers.find((l) => l.id === activeLayerId && l.type === 'brick');
            if (layer && layer.type === 'brick') {
              setSelection(layer.bricks.map((b) => b.id));
            }
          } catch {
            /* doc not ready */
          }
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
        if (isViewer || selection.length === 0 || !activeLayerId) return;
        void duplicateSelection();
        return;
      }

      // Ctrl/Cmd + Shift + ] — bring to front. Ctrl/Cmd + Shift + [ — send to back.
      // Desktop MainWindowMenus.cpp:391-396.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        if (isViewer || selection.length === 0 || !activeLayerId) return;
        reorderBricks(doc, activeLayerId, selection, 'front');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        if (isViewer || selection.length === 0 || !activeLayerId) return;
        reorderBricks(doc, activeLayerId, selection, 'back');
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
        if (isViewer || !activeLayerId) return;
        if (e.shiftKey) {
          if (selection.length === 0) return;
          ungroupBricks(doc, activeLayerId, selection);
        } else {
          if (selection.length < 2) return;
          groupBricks(doc, activeLayerId, selection);
        }
        return;
      }

      // Ctrl/Cmd + P — Select Path: BFS walk over connexion links from
      // the current selection, across all brick layers. Port of
      // MapView.cpp:1481-1543.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        try {
          const m = docToBbm(doc);
          const adj = buildConnectedAdj(m);
          const visited = new Set<string>(selection);
          const queue = [...selection];
          while (queue.length > 0) {
            const id = queue.shift()!;
            for (const nb of adj.get(id) ?? []) {
              if (!visited.has(nb)) { visited.add(nb); queue.push(nb); }
            }
          }
          setSelection([...visited]);
        } catch {
          /* doc not ready */
        }
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
        const factor = e.key === '-' ? 1 / 1.2 : 1.2;
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

      // Selected-ruler shortcuts: Delete/Backspace removes it; arrow
      // keys translate by the snap step. Must run BEFORE the brick
      // selection guard so a ruler-only selection (no bricks) still
      // honours these.
      if (selectedRulerId && map) {
        const rulerLayer = map.layers.find(
          (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === selectedRulerId),
        );
        if (rulerLayer && rulerLayer.type === 'ruler') {
          if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteRulerItem(doc, rulerLayer.id, selectedRulerId);
            setSelectedRulerId(null);
            return;
          }
          const STEP = snapStepStuds > 0 ? snapStepStuds : 1;
          let dxR = 0;
          let dyR = 0;
          if (e.key === 'ArrowLeft') dxR = -STEP;
          else if (e.key === 'ArrowRight') dxR = STEP;
          else if (e.key === 'ArrowUp') dyR = -STEP;
          else if (e.key === 'ArrowDown') dyR = STEP;
          if (dxR !== 0 || dyR !== 0) {
            e.preventDefault();
            moveRulerItem(doc, rulerLayer.id, selectedRulerId, dxR, dyR);
            return;
          }
        }
      }

      if (selection.length === 0) return;

      if (e.key === 'r' || e.key === 'R') {
        if (!activeLayerId) return;
        // Shift+R = CW (+step), R = CCW (-step). Matches desktop's MainWindow
        // keys (MainWindowMenus.cpp:418,423) where Shift+R is CW and
        // bare R is CCW; step is the configured rotation step.
        e.preventDefault();
        rotateBricks(doc, activeLayerId, selection, e.shiftKey ? rotationStepDegrees : -rotationStepDegrees);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // Group selected brick IDs by which layer they live in.  The
        // activeLayerId may be stale or the selection may span layers, so
        // we search all brick layers. Desktop's deleteSelected() does the
        // same (MapViewContextMenu.cpp deleteSelected walks all layers).
        if (map) {
          const selSet = new Set(selection);
          for (const layer of map.layers) {
            if (layer.type !== 'brick') continue;
            const layerBrickIds = layer.bricks
              .filter((b) => selSet.has(b.id))
              .map((b) => b.id);
            if (layerBrickIds.length > 0) {
              deleteBricks(doc, layer.id, layerBrickIds);
            }
          }
        } else if (activeLayerId) {
          deleteBricks(doc, activeLayerId, selection);
        }
        setSelection([]);
        return;
      }
      // Arrow-key nudge by the active grid-snap step (or 1 stud when
      // snap is off). Direct port of MapView.cpp:970-980. Applies to
      // bricks AND to the selected ruler (desktop nudges rulers too —
      // MapView.cpp:985-...).
      const NUDGE = snapStepStuds > 0 ? snapStepStuds : 1;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -NUDGE;
      else if (e.key === 'ArrowRight') dx = NUDGE;
      else if (e.key === 'ArrowUp') dy = -NUDGE;
      else if (e.key === 'ArrowDown') dy = NUDGE;
      if (dx !== 0 || dy !== 0) {
        e.preventDefault();
        if (map) {
          const selSet = new Set(selection);
          const byLayer = new Map<string, string[]>();
          for (const layer of map.layers) {
            if (layer.type !== 'brick') continue;
            const ids = layer.bricks.filter((b) => selSet.has(b.id)).map((b) => b.id);
            if (ids.length > 0) byLayer.set(layer.id, ids);
          }
          translateBricksAcrossLayers(doc, byLayer, dx, dy);
        } else if (activeLayerId) {
          translateBricks(doc, activeLayerId, selection, dx, dy);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    doc,
    selection,
    activeLayerId,
    setSelection,
    isViewer,
    saveNow,
    width,
    height,
    snapStepStuds,
    rotationStepDegrees,
    selectedRulerId,
    map,
  ]);

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
    const evt = e.evt as MouseEvent;

    // Middle-button pan — port of MapView.cpp:446-451 (desktop). Works on
    // any tool, on any target (brick or empty stage), so the user can
    // always reframe the canvas without changing tool.
    if (evt.button === 1) {
      evt.preventDefault();
      middlePanRef.current = { lastX: evt.clientX, lastY: evt.clientY };
      return;
    }

    if (e.target !== e.target.getStage()) return;
    const studs = pointerStuds();
    if (!studs) return;

    if (tool === 'select') {
      // Empty-space click in select mode → start marquee.
      setSelection([]);
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
      const step = useEditorStore.getState().snapStepStuds;
      const sx = step > 0 ? Math.round(studs.x / step) * step : studs.x;
      const sy = step > 0 ? Math.round(studs.y / step) * step : studs.y;
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
      useEditorStore.getState().setPan(panX + dx, panY + dy);
      return;
    }

    const studs = pointerStuds();
    if (!studs) return;
    useEditorStore.getState().setHudMouse(studs.x, studs.y);
    if (marquee) setMarquee({ ...marquee, x1: studs.x, y1: studs.y });
    // Continue the paint/erase stroke while the button is held.
    if ((tool === 'paint' || tool === 'erase') && paintStrokeRef.current && evt.buttons & 1) {
      doPaintStroke(studs.x, studs.y);
    }
    if (rulerDraft) {
      const step = useEditorStore.getState().snapStepStuds;
      const cx = step > 0 ? Math.round(studs.x / step) * step : studs.x;
      const cy = step > 0 ? Math.round(studs.y / step) * step : studs.y;
      setRulerDraft({ ...rulerDraft, curX: cx, curY: cy });
    }
    if (venueDraft) {
      const step = useEditorStore.getState().snapStepStuds;
      const cx = step > 0 ? Math.round(studs.x / step) * step : studs.x;
      const cy = step > 0 ? Math.round(studs.y / step) * step : studs.y;
      setVenueDraft({ ...venueDraft, curX: cx, curY: cy });
    }
    // Always broadcast cursor so peers can see us — even when we're
    // panning or hovering empty space.
    dispatchCursorMove(studs.x, studs.y);
  }

  function handleStageMouseLeave() {
    dispatchCursorLeave();
    middlePanRef.current = null;
    paintStrokeRef.current = null;
    useEditorStore.getState().setHudMouse(null, null);
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
      return;
    }
    paintStrokeRef.current = null;

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
    // Commit selection across EVERY visible brick layer — matches the
    // desktop's `MapView::mouseReleaseEvent` rubber-band, which calls
    // `QGraphicsView::mouseReleaseEvent` and lets Qt's scene selection
    // pick from every brick item regardless of layer.
    //
    // Hidden layers are skipped so the user can't accidentally select
    // bricks they can't see; the brick z-order across layers doesn't
    // affect the result because the marquee is purely AABB-based.
    if (map) {
      const ids: string[] = [];
      for (const layer of map.layers) {
        if (layer.type !== 'brick' || !layer.visible) continue;
        ids.push(...bricksInMarquee(marquee, layer.bricks));
      }
      setSelection(ids);
    }
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
    if (map) {
      const selSet = new Set(selection);
      for (const layer of map.layers) {
        if (layer.type !== 'brick') continue;
        const ids = layer.bricks.filter((b) => selSet.has(b.id)).map((b) => b.id);
        if (ids.length > 0) deleteBricks(doc, layer.id, ids);
      }
    } else if (activeLayerId) {
      deleteBricks(doc, activeLayerId, selection);
    }
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
    const entries = await readBricksFromClipboard();
    if (!entries || entries.length === 0) return;
    if (!activeLayerId) return;
    const targetLayerId = activeLayerId;
    const ids = insertBricks(
      doc,
      targetLayerId,
      entries.map((e) => ({
        partNumber: e.brick.partNumber,
        displayArea: { ...e.brick.displayArea },
        orientation: e.brick.orientation,
        altitude: e.brick.altitude,
      })),
      { dx: 1, dy: 1 },
    );
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

    const layerId = activeLayerId ?? ensureBrickLayer(doc);
    if (!activeLayerId) setActiveLayer(layerId);

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
    const layerId = activeLayerId ?? ensureBrickLayer(doc);
    if (!activeLayerId) setActiveLayer(layerId);

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
  exportImageRef.current = {
    toDataURL: ({ pixelRatio, transparent }: { pixelRatio: number; transparent: boolean }) => {
      const stage = stageRef.current;
      if (!stage) return null;
      return stage.toDataURL({
        pixelRatio,
        mimeType: 'image/png',
        ...(transparent ? { background: 'rgba(0,0,0,0)' } : {}),
      });
    },
    getStage: () => stageRef.current,
  };

  clipboardRef.current = {
    cut: () => void cutSelection(),
    copy: () => void copySelection(),
    paste: () => void pasteAtCursor(),
    delete: () => {
      if (selection.length === 0) return;
      if (map) {
        const selSet = new Set(selection);
        for (const layer of map.layers) {
          if (layer.type !== 'brick') continue;
          const ids = layer.bricks.filter((b) => selSet.has(b.id)).map((b) => b.id);
          if (ids.length > 0) deleteBricks(doc, layer.id, ids);
        }
      } else if (activeLayerId) {
        deleteBricks(doc, activeLayerId, selection);
      }
      setSelection([]);
    },
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
        // MapView::wheelEvent (MapView.cpp:351-385) + AnchorUnderMouse
        // (MapView.cpp:89): step is 1.0015^deltaY clamped to ±480.
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
          const clamped = Math.max(-480, Math.min(480, a.deltaY));
          a.deltaY = 0;
          const wzf = useEditorStore.getState().wheelZoomFactor;
          const step = Math.pow(1.0015 * wzf, -clamped);
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
      <KonvaLayer listening={false}>
        <GridLayer
          map={map}
          viewport={{
            studXMin: pxToStud(-panX / zoom),
            studYMin: pxToStud(-panY / zoom),
            studXMax: pxToStud((width - panX) / zoom),
            studYMax: pxToStud((height - panY) / zoom),
          }}
        />
      </KonvaLayer>
      {/* Background image — drawn above grid, below everything else.
          Port of MapViewPaint.cpp:43-70 background-image rendering. */}
      <BackgroundImageLayer doc={doc} map={map} />
      {/* Venue overlay sits beneath everything — port of
          SceneBuilderSidecar.cpp:50-52 (LayerSink z = -100000). */}
      <KonvaLayer listening={!isViewer}>
        {isViewer
          ? <VenueOverlay venue={readSidecarFromDoc(doc)?.venue ?? null} labelFontPx={venueLabelPx} />
          : <VenueOverlay venue={readSidecarFromDoc(doc)?.venue ?? null} labelFontPx={venueLabelPx} onDoubleClick={onOpenVenueProps} />}
      </KonvaLayer>
      {/* Area layers (paint-area cells) sit ON TOP of the grid but
          UNDER the bricks — port of SceneBuilder.cpp:793-806's z-order
          where each layer gets baseZ = index * 1000 in declaration order. */}
      <KonvaLayer listening={false}>
        <AreaLayers map={map} />
      </KonvaLayer>
      <KonvaLayer>
        <BrickLayer
          map={map}
          doc={doc}
          isViewer={isViewer}
          onEditBrick={(brick, layerId, meta) => setEditing({ brick, layerId, meta })}
        />
      </KonvaLayer>
      {/* Electric circuit overlay — port of SceneBuilderElectric.cpp.
          z = 500 in desktop (above bricks, below sidecar labels). */}
      {showElectricCircuits && map && (
        <KonvaLayer listening={false}>
          <ElectricCircuitLayer map={map} partsByKey={partsByKey} />
        </KonvaLayer>
      )}
      {/* Text labels render ABOVE bricks so they aren't occluded by
          baseplate sprites. SceneBuilder.cpp:793-806 z-order. */}
      <KonvaLayer listening={!isViewer}>
        <TextLayers
          map={map}
          isViewer={isViewer}
          onEditText={(ref) => setEditingText(ref)}
        />
        <RulerLayers
          map={map}
          selectedRulerId={selectedRulerId}
          onRulerClick={(id) => setSelectedRulerId(id)}
          onRulerDoubleClick={(id) => {
            const layer = map.layers.find(
              (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === id),
            );
            if (!layer || layer.type !== 'ruler') return;
            const item = layer.rulerItems.find((r) => r.id === id);
            if (!item) return;
            setSelectedRulerId(id);
            setEditingRuler({ item, layerId: layer.id });
          }}
          onEndpointDrag={(rulerId, which, studX, studY, commit) => {
            // Find the ruler's layer so the mutation knows where to land.
            const layer = map.layers.find(
              (l) => l.type === 'ruler' && l.rulerItems.some((r) => r.id === rulerId),
            );
            if (!layer || layer.type !== 'ruler') return;
            // Snap the endpoint to the active grid step on commit
            // (matches desktop MapView.cpp:556-559 — endpoint drag
            // snaps live AND on commit). Live moves stay raw so the
            // user gets pixel-precise feedback while dragging.
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
          : <AnchoredLabels map={map} labels={readSidecarFromDoc(doc)?.anchoredLabels ?? []} modules={readSidecarFromDoc(doc)?.modules ?? []} zoom={zoom} onDoubleClick={setEditingLabel} />}
        <ModuleOverlay
          map={map}
          modules={readSidecarFromDoc(doc)?.modules ?? []}
        />
      </KonvaLayer>
      <KonvaLayer listening={false}>
        {/*
          Drag-from-Parts-panel ghost. Same PlaceGhost component, fed
          from `dropPart` instead of the place-tool cursor. Mirrors
          MapView::updateDragPreview at MapView.cpp:1715-1761.
        */}
        {dropPart && (() => {
          const part = partsByKey.get(dropPart.key.toLowerCase()) ?? null;
          if (!part || !map) {
            return (
              <PlaceGhost
                part={part}
                cursorStudX={dropPart.studX}
                cursorStudY={dropPart.studY}
              />
            );
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
          return (
            <PlaceGhost
              part={part}
              cursorStudX={snapped.centreX}
              cursorStudY={snapped.centreY}
            />
          );
        })()}
        <MarqueeOverlay marquee={marquee} />
        <SnapRing />
        {rulerDraft && <RulerDraftPreview draft={rulerDraft} />}
        {venueDraft && <VenueDraftPreview draft={venueDraft} />}
        <RemoteCursors awareness={awareness} map={map} />
      </KonvaLayer>
      {showExportWatermark && map && (() => {
        const parts = [map.author, map.lug, map.event].filter(Boolean);
        if (parts.length === 0) return null;
        const stamp = parts.join(' / ');
        const fontSize = Math.max(8, height / 60);
        return (
          <KonvaLayer listening={false}>
            <Text
              text={stamp}
              fontSize={fontSize}
              fontFamily="sans-serif"
              fill="rgba(0,0,0,0.55)"
              x={10}
              y={height - fontSize - 10}
              width={width - 20}
              align="right"
            />
          </KonvaLayer>
        );
      })()}
    </Stage>
  );

  function commitAddText(r: TextDialogResult) {
    // Place at the current cursor (or stage centre if cursor isn't
    // over the canvas yet). `addTextCell` infers a stud-size box from
    // the requested font size so the renderer's probe-and-fit lands
    // somewhere reasonable.
    const target = pointerStuds() ?? { x: width / 2 / 8, y: height / 2 / 8 };
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
        <TextDialog onClose={() => setShowAddText(false)} onCommit={commitAddText} />
      )}
      {editingText && (
        <TextDialog
          initial={editingText.cell}
          onClose={() => setEditingText(null)}
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
          onDelete={() => {
            if (selection.length === 0) return;
            if (map) {
              const selSet = new Set(selection);
              for (const layer of map.layers) {
                if (layer.type !== 'brick') continue;
                const ids = layer.bricks.filter((b) => selSet.has(b.id)).map((b) => b.id);
                if (ids.length > 0) deleteBricks(doc, layer.id, ids);
              }
            } else if (activeLayerId) {
              deleteBricks(doc, activeLayerId, selection);
            }
            setSelection([]);
          }}
          onRotateCCW={() => {
            if (activeLayerId && selection.length > 0)
              rotateBricks(doc, activeLayerId, selection, -rotationStepDegrees);
          }}
          onRotateCW={() => {
            if (activeLayerId && selection.length > 0)
              rotateBricks(doc, activeLayerId, selection, rotationStepDegrees);
          }}
          onBringToFront={() => {
            if (activeLayerId && selection.length > 0)
              reorderBricks(doc, activeLayerId, selection, 'front');
          }}
          onSendToBack={() => {
            if (activeLayerId && selection.length > 0)
              reorderBricks(doc, activeLayerId, selection, 'back');
          }}
          onGroup={() => {
            if (activeLayerId && selection.length >= 2)
              groupBricks(doc, activeLayerId, selection);
          }}
          onUngroup={() => {
            if (activeLayerId && selection.length > 0)
              ungroupBricks(doc, activeLayerId, selection);
          }}
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
            const layerId = ensureTextLayer(doc);
            const heightStuds = 3;
            const widthStuds = 12;
            addTextCell(doc, layerId, {
              centreX: ctxMenu.studX,
              centreY: ctxMenu.studY,
              widthStuds,
              heightStuds,
              text: 'Text',
              font: { family: 'Arial', size: 24, style: 'Regular' },
              fontColor: { kind: 'argb', argb: 'ff000000' },
              orientation: 0,
            });
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
      <span className="text-[10px] text-neutral-300 drop-shadow">{label}</span>
      <div
        className="rounded bg-neutral-200/80"
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
  onGroup, onUngroup, onSelectConnected, onAddTextHere, onProperties,
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
  onAddTextHere: () => void; onProperties: () => void;
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
      className="flex flex-col rounded border border-neutral-700 bg-neutral-900 py-1 shadow-xl text-neutral-200"
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
 * Port of MapViewPaint.cpp:43-70. When no rect is set the image stretches
 * to the brick bounding box; when a rect is stored it is placed there.
 */
function BackgroundImageLayer({
  doc,
  map,
}: {
  doc: import('yjs').Doc;
  map: import('@cld/model').BbmMap | null;
}) {
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

  const PX = 8;
  let x: number, y: number, w: number, h: number;
  if (bg.rect) {
    x = bg.rect.x * PX; y = bg.rect.y * PX;
    w = bg.rect.w * PX; h = bg.rect.h * PX;
  } else if (map) {
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
    if (!Number.isFinite(minX)) return null;
    x = minX * PX; y = minY * PX; w = (maxX - minX) * PX; h = (maxY - minY) * PX;
  } else {
    return null;
  }

  return (
    <KonvaLayer listening={false}>
      <KonvaImage image={img} x={x} y={y} width={w} height={h} opacity={bg.opacity} listening={false} />
    </KonvaLayer>
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
  const selectionCount = useEditorStore((s) => s.selection.length);
  const zoom = useEditorStore((s) => s.zoom);
  const tool = useEditorStore((s) => s.tool);
  const mapW = useEditorStore((s) => s.hudMapWidthStuds);
  const mapH = useEditorStore((s) => s.hudMapHeightStuds);
  const statusMessage = useEditorStore((s) => s.statusMessage);
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
        {statusMessage ? (
          <span className="text-blue-400 transition-opacity">{statusMessage}</span>
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
        {venue !== null && (
          <span
            title={venue.enabled ? `Venue: ${venue.name || 'unnamed'} (${venue.edges.length} edges)` : 'Venue disabled'}
            className={venue.enabled ? 'text-green-400' : 'text-neutral-500'}
          >
            Venue: {venue.enabled ? (venue.name || 'unnamed') : 'disabled'}
          </span>
        )}
        {venue?.enabled && venue.minWalkwayStuds > 0 && budgetMap && (() => {
          // Simplified AABB clearance check: for each non-Wall edge segment
          // compute the walkway buffer band AABB and flag bricks that overlap it.
          const buf = venue.minWalkwayStuds;
          let violations = 0;
          for (const edge of venue.edges) {
            if (edge.kind === 0 /* Wall */ || !edge.poly || edge.poly.length < 2) continue;
            for (let i = 1; i < edge.poly.length; i++) {
              const a = edge.poly[i - 1]!;
              const b = edge.poly[i]!;
              const segMinX = Math.min(a.x, b.x) - buf;
              const segMaxX = Math.max(a.x, b.x) + buf;
              const segMinY = Math.min(a.y, b.y) - buf;
              const segMaxY = Math.max(a.y, b.y) + buf;
              for (const layer of budgetMap.layers) {
                if (layer.type !== 'brick') continue;
                for (const brick of layer.bricks) {
                  const { x, y, width, height } = brick.displayArea;
                  if (x < segMaxX && x + width > segMinX && y < segMaxY && y + height > segMinY) {
                    violations++;
                  }
                }
              }
            }
          }
          if (violations === 0) return null;
          return (
            <span className="text-orange-400" title={`${violations} brick(s) inside the ${buf} stud walkway buffer`}>
              ⚠ {violations} in walkway
            </span>
          );
        })()}
        {budgetLimits.size > 0 && (() => {
          let over = 0;
          if (budgetMap) {
            const usage = new Map<string, number>();
            for (const layer of budgetMap.layers) {
              if (layer.type !== 'brick') continue;
              for (const b of layer.bricks) usage.set(b.partNumber, (usage.get(b.partNumber) ?? 0) + 1);
            }
            for (const [part, limit] of budgetLimits) {
              if (limit >= 0 && (usage.get(part) ?? 0) > limit) over++;
            }
          }
          return (
            <span className={over > 0 ? 'text-red-400' : 'text-green-400'}
              title="Budget status">
              Budget: {over > 0 ? `${over} over` : 'OK'}
            </span>
          );
        })()}
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
  onSaveAsSet,
  onInsertLabel,
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
  onSaveAsSet: () => void;
  onInsertLabel: () => void;
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
    { label: 'Save Selection as Module...', action: onSaveModule },
    { label: 'Import .bbm as Module...', action: onImportBbm },
    { label: 'Save Selection as Set...', action: onSaveAsSet },
    { label: 'Insert Anchored Label...  Ctrl+L', action: onInsertLabel },
    { label: '—', action: () => {} },
    { label: 'Export as Image...', action: onExportImage },
    { label: 'Export Part List (CSV)...', action: onExportCsv },
    { label: '—', action: () => {} },
    { label: 'Show Grid', action: () => setShowGrid(!showGrid), checked: showGrid },
    { label: 'Show Connection Points', action: () => setShowConnectionPoints(!showConnectionPoints), checked: showConnectionPoints },
    { label: 'Show Brick Hulls', action: () => setShowBrickHulls(!showBrickHulls), checked: showBrickHulls },
    { label: 'Show Brick Elevation', action: () => setShowBrickElevation(!showBrickElevation), checked: showBrickElevation },
    { label: 'Show Ruler Attach Points', action: () => setShowRulerAttachPoints(!showRulerAttachPoints), checked: showRulerAttachPoints },
    { label: 'Always Show Connections', action: () => setAlwaysShowConnections(!alwaysShowConnections), checked: alwaysShowConnections },
    { label: 'Show Module Names', action: () => setShowModuleNames(!showModuleNames), checked: showModuleNames },
    { label: 'Show Module Frames', action: () => setShowModuleFrames(!showModuleFrames), checked: showModuleFrames },
    { label: '—', action: () => {} },
    { label: '—', action: () => {} },
    { label: 'Budget...', action: onBudget },
    { label: 'Preferences...  Ctrl+,', action: onPreferences },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
      >
        Map
      </button>
      {open && (
        <ul
          className="absolute right-0 top-full z-30 mt-1 w-52 rounded border border-neutral-700 bg-neutral-900 text-xs shadow"
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
  // Re-project on every Yjs update so layer ops (visibility, transparency,
  // rename, add, delete, move, name change) show immediately. Earlier
  // versions of this component held the useMemo deps on `[doc]` only,
  // which meant the projection was cached forever — every Yjs change
  // triggered a re-render but the same `BbmMap` was reused. Including
  // `rev` from the snapshot hook ties the memo to actual doc mutations.
  const rev = useYjsSnapshot(doc);
  const map = useMemo(() => {
    try {
      return docToBbm(doc);
    } catch {
      return null;
    }
  }, [doc, rev]);
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
  const allIds = Object.keys(PANEL_TITLES);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
        title="Toggle panels"
      >
        Panels
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <ul className="absolute right-0 top-full z-30 mt-1 min-w-[168px] rounded border border-neutral-700 bg-neutral-900 text-xs shadow">
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
        className="h-6 w-8 cursor-pointer rounded border border-neutral-700 bg-transparent"
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
        className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
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
        className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-xs"
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

function HeaderEditButtons({
  saveNow,
  clipboardRef,
}: {
  saveNow: () => Promise<void> | void;
  clipboardRef: React.MutableRefObject<{ cut: () => void; copy: () => void; paste: () => void; delete: () => void } | null>;
}) {
  const selection = useEditorStore((s) => s.selection);
  const hasSel = selection.length > 0;
  const btnCls = 'rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-default';
  return (
    <>
      <div className="h-4 w-px bg-neutral-700" />
      <button onClick={() => void saveNow()} title="Save (Ctrl+S)" className={btnCls}>
        Save
      </button>
      <div className="h-4 w-px bg-neutral-700" />
      <button onClick={() => clipboardRef.current?.cut()} disabled={!hasSel} title="Cut (Ctrl+X)" className={btnCls}>
        Cut
      </button>
      <button onClick={() => clipboardRef.current?.copy()} disabled={!hasSel} title="Copy (Ctrl+C)" className={btnCls}>
        Copy
      </button>
      <button onClick={() => clipboardRef.current?.paste()} title="Paste (Ctrl+V)" className={btnCls}>
        Paste
      </button>
      <button
        onClick={() => clipboardRef.current?.delete()}
        disabled={!hasSel}
        title="Delete (Del)"
        className={btnCls + ' hover:bg-red-900/40'}
      >
        Delete
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
