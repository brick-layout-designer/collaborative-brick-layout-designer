import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Line, Rect, Text as KonvaText } from 'react-konva';
import * as Y from 'yjs';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import { useQuery } from '@tanstack/react-query';
import { api, spriteUrlFor, type PartWire } from '../../api';
import { useEditorStore, type Tool } from '../editorStore';
import { useShallow } from 'zustand/react/shallow';
import { readSidecarFromDoc } from '@cld/ydoc';
import {
  deleteBricks,
  moveBrick,
  moveBrickAndOrient,
  setActiveConnectionPoint,
} from '../mutations';
import { annoCount, deleteMixedSelection, translateMixedSelection } from '../mixedSelection';
import { LOCAL_ORIGIN } from '../useLayoutDoc';
import { studToPx } from './coords';
import { ensureSprite, getSpriteSync } from './spriteCache';
import { liveDragSnap, nearestConnectionIndex } from '../snap';
import { annoNodeNames, collectNodes, restoreNodes, shiftNodes, type NodeSnap } from './groupDragNodes';
import { EXPORT_HIDE } from '../exportRender';
import { indexParts } from '../partIndex';
import { drawOrder, pivotOf } from '../brickGeometry';
import { startFlexSession } from '../flexSession';

/** Konva's double-click window; the second press of a double-click starts a flex move. */
const DOUBLE_CLICK_MS = 400;
const lastPress = { id: '', time: 0, selection: [] as readonly string[] };

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  /** When true, the canvas is read-only (no drag, no delete-on-click). */
  isViewer?: boolean;
  /** Double-click → open per-brick properties dialog. */
  onEditBrick?: (brick: Brick, layerId: string, meta: PartWire | undefined) => void;
}

/**
 * All brick layers. Memoised, and each glyph is memoised with only
 * primitive / identity-stable props, so a re-render of the canvas (pan,
 * zoom, marquee, HUD) or an edit to ONE brick re-renders only what
 * changed. That relies on the shared cached projection (useDocMap), which
 * keeps unchanged Brick objects identical across doc updates.
 */
export const BrickLayer = memo(function BrickLayer({ map, doc, isViewer = false, onEditBrick }: Props) {
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });

  // Bricks store the catalog key (`<partNumber>.<colorCode>` lowercased)
  // in their `partNumber` field — that's how desktop CLD writes the .bbm.
  // Index by `key` so the lookup matches without a parse step. Fall back
  // to bare `partNumber` for the rare "no colour code" entries (group
  // parts and some custom uploads). Built once per catalog (it used to be
  // rebuilt on every render, which also broke every glyph's memo).
  const { partsByKey, byBarePartNumber } = useMemo(() => {
    const byKey = indexParts(catalog.data?.parts);
    const bare = new Map<string, PartWire>();
    for (const p of catalog.data?.parts ?? []) {
      // First catalog entry per bare part number — what the old
      // per-brick linear `lookupByPartNumberOnly` scan returned.
      if (!bare.has(p.partNumber.toLowerCase())) bare.set(p.partNumber.toLowerCase(), p);
    }
    return { partsByKey: byKey, byBarePartNumber: bare };
  }, [catalog.data]);

  // Store-driven display state, subscribed ONCE here rather than per glyph
  // (thousands of per-glyph subscriptions each ran on every store write,
  // e.g. the per-frame HUD mouse update).
  const selection = useEditorStore((s) => s.selection);
  const view = useEditorStore(
    useShallow((s) => ({
      tool: s.tool,
      showConnectionPoints: s.showConnectionPoints,
      alwaysShowConnections: s.alwaysShowConnections,
      showBrickHulls: s.showBrickHulls,
      showBrickElevation: s.showBrickElevation,
      selectionTint: s.selectionTint,
      snapActive: s.liveSnap !== null,
    })),
  );
  const selectedIds = useMemo(() => new Set(selection), [selection]);

  // Glyphs read the map only inside event handlers; hand them a stable
  // getter instead of the map itself (a new object on every doc change).
  const mapRef = useRef(map);
  mapRef.current = map;
  const getMap = useCallback(() => mapRef.current, []);

  const brickLayers = map.layers.filter((l): l is LayerBrick => l.type === 'brick');
  return (
    <Group>
      {brickLayers.map((layer) => {
        if (!layer.visible) return null;
        // Apply the per-layer transparency (0-100 → 0..1) on the layer
        // group so every brick inherits it. Mirrors desktop
        // SceneBuilder.cpp:832-834 — `setOpacity(L.transparency/100.0)`.
        const opacity = Math.max(0, Math.min(100, layer.transparency)) / 100;
        const hull = layer.hullProperties;
        const showHull = (!isViewer && view.showBrickHulls) || hull.isVisible;
        const hullColor = hullColorToCss(hull.hullColor);
        const showElevation = (!isViewer && view.showBrickElevation) || layer.displayBrickElevation;
        return (
          <Group key={layer.id} opacity={opacity}>
            {drawOrder(layer.bricks).map((brick) => {
              const lower = brick.partNumber.toLowerCase();
              return (
                <BrickGlyph
                  key={brick.id}
                  brick={brick}
                  layerId={layer.id}
                  doc={doc}
                  meta={partsByKey.get(lower) ?? byBarePartNumber.get(lower)}
                  isViewer={isViewer}
                  isSelected={!isViewer && selectedIds.has(brick.id)}
                  tool={isViewer ? 'select' : view.tool}
                  showConnectionPoints={!isViewer && view.showConnectionPoints}
                  alwaysShowConnections={!isViewer && view.alwaysShowConnections}
                  showHull={showHull}
                  hullColor={hullColor}
                  hullThickness={hull.hullThickness}
                  showElevation={showElevation}
                  selectionTint={isViewer ? 'ffcc00' : view.selectionTint}
                  // Only a selected glyph shows the halo, so only it re-renders
                  // when a snap starts or ends.
                  snapActive={!isViewer && view.snapActive && selectedIds.has(brick.id)}
                  getMap={getMap}
                  partsByKey={partsByKey}
                  {...(onEditBrick ? { onEditBrick } : {})}
                />
              );
            })}
          </Group>
        );
      })}
    </Group>
  );
});

const BrickGlyph = memo(function BrickGlyph({
  brick,
  layerId,
  doc,
  meta,
  isViewer,
  isSelected,
  tool,
  showConnectionPoints,
  alwaysShowConnections,
  showHull,
  hullColor,
  hullThickness,
  showElevation,
  selectionTint,
  snapActive,
  getMap,
  partsByKey,
  onEditBrick,
}: {
  brick: Brick;
  layerId: string;
  doc: Y.Doc;
  isViewer: boolean;
  meta: PartWire | undefined;
  isSelected: boolean;
  tool: Tool;
  showConnectionPoints: boolean;
  alwaysShowConnections: boolean;
  showHull: boolean;
  hullColor: string;
  hullThickness: number;
  showElevation: boolean;
  selectionTint: string;
  /** A connection snap is live: the halo turns green (SelectionOverlay.cpp:26-29). */
  snapActive: boolean;
  getMap: () => BbmMap;
  partsByKey: Map<string, PartWire>;
  onEditBrick?: (brick: Brick, layerId: string, meta: PartWire | undefined) => void;
}) {
  const spriteUrl = meta ? spriteUrlFor(meta) : '';
  const groupRef = useRef<Konva.Group | null>(null);

  // Ensure the sprite gets loaded into the sync cache. A successful load
  // bumps a counter so this component re-renders and renders the image.
  const [, setRev] = useState(0);
  useEffect(() => {
    if (!spriteUrl) return;
    let cancelled = false;
    ensureSprite(spriteUrl)
      .then(() => {
        if (!cancelled) setRev((r) => r + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [spriteUrl]);

  const w = studToPx(brick.displayArea.width);
  const h = studToPx(brick.displayArea.height);
  // The Group sits on the brick's pivot (its sprite centre), which is
  // `imageOffset` from the displayArea centre for parts with a <hull>
  // (BrickPlacement.h). Everything below is drawn around it.
  const pivot = pivotOf(brick, meta);
  const pivotOff = { x: pivot.x - (brick.displayArea.x + brick.displayArea.width / 2), y: pivot.y - (brick.displayArea.y + brick.displayArea.height / 2) };

  const sprite = spriteUrl ? getSpriteSync(spriteUrl) : null;

  // Desktop draws the sprite at its NATURAL pixel size, scaled by
  // (kPixelsPerStud / authoredPxPerStud), then rotates around the
  // sprite's centre — see SceneBuilder.cpp:188-204. The .bbm's
  // `displayArea` is the AABB of the *rotated* sprite, so for any
  // brick with non-zero orientation, stretching to displayArea
  // distorts the image. We compute spriteWpx/spriteHpx from the
  // natural image size and use displayArea ONLY for placement (centre)
  // and selection (the AABB outline).
  const authoredPxPerStud = meta?.pxPerStud && meta.pxPerStud > 0 ? meta.pxPerStud : 8;
  const spriteScale = 8 / authoredPxPerStud; // STUD_PX / authoredPxPerStud
  const spriteWpx = sprite ? sprite.naturalWidth * spriteScale : w;
  const spriteHpx = sprite ? sprite.naturalHeight * spriteScale : h;

  function handleClick(e: KonvaEventObject<MouseEvent | TouchEvent>) {
    // Right-click: if the clicked brick is already selected keep the whole
    // selection so the context menu applies to all selected bricks. If it's
    // NOT selected, select just this brick (standard OS right-click behaviour).
    if ('button' in e.evt && e.evt.button === 2) {
      if (tool === 'select') {
        const currentSel = useEditorStore.getState().selection;
        if (!currentSel.includes(brick.id)) {
          useEditorStore.getState().setSelection([brick.id]);
        }
      }
      return;
    }
    if (tool === 'select') {
      // Match Qt's default QGraphicsScene selection (the path desktop's
      // MapView::mousePressEvent falls through to at MapView.cpp:534):
      //   * plain click  → clear selection, select THIS item
      //   * shift / ctrl → toggle this item, keep the rest
      e.cancelBubble = true;
      const additive =
        'shiftKey' in e.evt ? e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey : false;

      // Group-aware selection: clicking a brick that belongs to a
      // group selects every brick sharing that group id, mirroring the
      // desktop's group selection behaviour. (`brick.myGroup` is empty
      // when ungrouped.)
      const groupMembers = brick.myGroup
        ? collectGroupMembers(getMap(), brick.myGroup)
        : [brick.id];

      if (additive) {
        // Shift/ctrl-click toggles the whole group on/off, keeping any
        // selected rulers / labels / text (mixed selection).
        const sel = new Set(useEditorStore.getState().selection);
        const allIn = groupMembers.every((id) => sel.has(id));
        if (allIn) for (const id of groupMembers) sel.delete(id);
        else for (const id of groupMembers) sel.add(id);
        useEditorStore.setState({ selection: [...sel] });
      } else {
        useEditorStore.getState().setSelection(groupMembers);
      }
    } else if (tool === 'delete' && !isViewer) {
      e.cancelBubble = true;
      deleteBricks(doc, layerId, [brick.id]);
    }
  }

  /**
   * Grab anchor — the connection nearest the press, captured on
   * mouse-down (desktop MapView.cpp:538-543 → captureGrabAnchor,
   * MapViewDrag.cpp:155-217). Persisted as the brick's active connection
   * and used as the snap lead of a single-brick drag.
   */
  const grabConnRef = useRef<number>(-1);

  function handleMouseDown(e: KonvaEventObject<MouseEvent>) {
    grabConnRef.current = -1;
    if (isViewer || tool !== 'select' || e.evt.button !== 0) return;
    const stage = e.target.getStage();
    const ptr = stage?.getPointerPosition();
    if (!stage || !ptr) return;
    const p = stage.getAbsoluteTransform().copy().invert().point(ptr);

    // The second press of a double-click on a hinged chain starts a flex
    // move (desktop MapView::mouseDoubleClickEvent → startFlexMove).
    const now = performance.now();
    const second = lastPress.id === brick.id && now - lastPress.time < DOUBLE_CLICK_MS;
    // The selection as it was before the double-click's first press: that
    // click may have narrowed it to this brick (desktop pressSelection_).
    const pressSelection = lastPress.selection;
    if (!second) {
      lastPress.selection = useEditorStore.getState().selection;
      // A fresh press: an earlier flex move's release may never have
      // produced its double-click event.
      flexMovedRef.current = false;
    }
    lastPress.id = second ? '' : brick.id;
    lastPress.time = now;
    if (second) {
      const group = groupRef.current;
      const started = startFlexSession({
        stage,
        doc,
        map: getMap(),
        layerId,
        grabbedId: brick.id,
        pressSelection: pressSelection.includes(brick.id) ? pressSelection : [],
        mouseStuds: { x: p.x / studToPx(), y: p.y / studToPx() },
        partsByKey,
        onEnd: (moved) => {
          group?.draggable(true);
          // Moved: the release is not a double-click that opens properties.
          if (moved) flexMovedRef.current = true;
        },
      });
      if (started) {
        // The chain bends instead of the brick being dragged.
        group?.draggable(false);
        e.cancelBubble = true;
        return;
      }
    }
    const idx = nearestConnectionIndex(brick, meta, p.x / studToPx(), p.y / studToPx());
    if (idx < 0) return;
    grabConnRef.current = idx;
    setActiveConnectionPoint(doc, layerId, brick.id, idx);
  }

  /** Set when a flex move bent the chain, so the double-click doesn't open properties. */
  const flexMovedRef = useRef(false);

  /** Selected rulers / labels moving along with this brick's drag. */
  const annoNodesRef = useRef<NodeSnap[]>([]);

  /**
   * Orientation the snap algorithm last suggested during a live drag.
   * Written each frame in handleDragMove; read in handleDragEnd to commit.
   * Null when no connection snap is active.
   */
  const snapOrientRef = useRef<number | null>(null);
  /** Last status-bar snap hint, to avoid a store write per drag frame. */
  const snapHintRef = useRef<string | null>(null);

  /**
   * Snapshot of every selected brick at drag-start. Lets `handleDragMove`
   * translate the entire selection rigidly with the leader. Mirrors the
   * desktop's `dragStart_` vector populated by `captureDragStart`
   * (MapViewDrag.cpp:106-127) and reused in `applyLiveConnectionSnap`
   * to apply a uniform `shiftPx` to every moving item.
   */
  const dragStartRef = useRef<
    | {
        leaderId: string;
        leaderStartCentre: { x: number; y: number };
        siblings: {
          id: string;
          startCentre: { x: number; y: number };
          node: Konva.Node | null;
          part: PartWire | undefined;
          links: { linkedTo: string }[];
          orientation: number;
        }[];
      }
    | null
  >(null);

  function handleDragStart(e: KonvaEventObject<DragEvent>) {
    snapOrientRef.current = null;
    if (isViewer) return;
    if (tool !== 'select') return;
    const map = getMap();
    const { selection, annoSelection } = useEditorStore.getState();
    // Selected rulers and labels move with the bricks (mixed selection,
    // MapViewDrag.cpp:124-153); only when this brick is part of it.
    annoNodesRef.current = selection.includes(brick.id)
      ? collectNodes(e.target.getStage(), annoNodeNames(annoSelection))
      : [];
    // Only the brick under the cursor fires its own onDragStart in
    // Konva; the rest of the selection isn't dragged by Konva itself —
    // we translate them by hand on dragmove.
    const isMulti = selection.length > 1 && selection.includes(brick.id);
    if (!isMulti) {
      dragStartRef.current = null;
      return;
    }
    const sel = new Set(selection);
    const leaderStart = pivotOf(brick, meta);
    // Resolve the sibling Konva nodes once here; looking each one up with
    // `stage.findOne` on every dragmove frame walked the whole scene graph
    // per sibling per frame.
    const stage = e.target.getStage();
    const siblings: NonNullable<typeof dragStartRef.current>['siblings'] = [];
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (b.id === brick.id || !sel.has(b.id)) continue;
        siblings.push({
          id: b.id,
          startCentre: pivotOf(b, partsByKey.get(b.partNumber.toLowerCase())),
          node: stage?.findOne(`.brick-${b.id}`) ?? null,
          part: partsByKey.get(b.partNumber.toLowerCase()),
          links: b.connexions,
          orientation: b.orientation,
        });
      }
    }
    dragStartRef.current = {
      leaderId: brick.id,
      leaderStartCentre: leaderStart,
      siblings,
    };
    void e;
  }

  /**
   * Apply live connection-snap mid-drag — port of
   * MapView::applyLiveConnectionSnap (MapViewDrag.cpp:239-410). Adjusts
   * the dragged Group's px position so the leader's nearest free
   * connection lands on the nearest matching free connection in the
   * rest of the map; for a multi-brick drag, every other selected
   * brick gets translated by the SAME delta so the group moves rigidly.
   */
  function handleDragMove(e: KonvaEventObject<DragEvent>) {
    if (isViewer) return;
    if (tool !== 'select') return;

    const node = e.target;
    const centreStudX = node.x() / studToPx();
    const centreStudY = node.y() / studToPx();
    const stage = node.getStage();
    const ptr = stage?.getPointerPosition();
    let mouseStudX = centreStudX;
    let mouseStudY = centreStudY;
    if (stage && ptr) {
      const t = stage.getAbsoluteTransform().copy().invert();
      const scenePos = t.point(ptr);
      mouseStudX = scenePos.x / studToPx();
      mouseStudY = scenePos.y / studToPx();
    }

    const dragStart = dragStartRef.current;
    const isMulti = !!dragStart && dragStart.siblings.length > 0;

    const result = liveDragSnap(
      {
        part: meta,
        movingId: brick.id,
        ...(isMulti
          ? {
              siblings: dragStart.siblings.map((s) => ({
                id: s.id,
                part: s.part,
                links: s.links,
                offsetX: s.startCentre.x - dragStart.leaderStartCentre.x,
                offsetY: s.startCentre.y - dragStart.leaderStartCentre.y,
                orientation: s.orientation,
              })),
            }
          : {}),
        movingLinks: brick.connexions,
        centreX: centreStudX,
        centreY: centreStudY,
        width: brick.displayArea.width,
        height: brick.displayArea.height,
        pivotOffsetX: pivotOff.x,
        pivotOffsetY: pivotOff.y,
        mouseStudX,
        mouseStudY,
        orientation: brick.orientation,
        snapStepStuds: useEditorStore.getState().snapStepStuds,
        ...(!isMulti && grabConnRef.current >= 0 ? { leadConnIndex: grabConnRef.current } : {}),
      },
      getMap(),
      partsByKey,
    );

    // Position the leader at the snapped centre. A single-brick connection
    // snap also rotates it (mouth-to-mouth); the centre is already
    // rotation-aligned for that orientation, so the joint meets exactly.
    // Without a snap, restore the stored orientation (a previous frame may
    // have rotated it towards a target the cursor has since left).
    node.position({
      x: result.centreX * studToPx(),
      y: result.centreY * studToPx(),
    });
    snapOrientRef.current = result.newOrientation;
    node.rotation(result.newOrientation ?? brick.orientation);

    // Translate every other selected brick by the same delta so the
    // group moves rigidly. Match desktop's MapViewDrag.cpp:386-395 —
    // shiftPx applied to every item in dragStart_.
    if (isMulti && stage) {
      const dxStud = result.centreX - dragStart.leaderStartCentre.x;
      const dyStud = result.centreY - dragStart.leaderStartCentre.y;
      for (const sib of dragStart.siblings) {
        const sibNode = sib.node;
        if (sibNode) {
          sibNode.position({
            x: (sib.startCentre.x + dxStud) * studToPx(),
            y: (sib.startCentre.y + dyStud) * studToPx(),
          });
        }
      }
    }

    if (annoNodesRef.current.length > 0) {
      const startX = isMulti ? dragStart.leaderStartCentre.x : pivot.x;
      const startY = isMulti ? dragStart.leaderStartCentre.y : pivot.y;
      shiftNodes(annoNodesRef.current, (result.centreX - startX) * studToPx(), (result.centreY - startY) * studToPx());
    }

    if (result.snappedToConnection && result.ringStudX !== null) {
      useEditorStore.getState().setLiveSnap({ studX: result.ringStudX, studY: result.ringStudY! });
    } else {
      useEditorStore.getState().setLiveSnap(null);
    }

    // Status-bar snap diagnostic, as desktop shows during a live drag
    // (MapViewDrag.cpp:352-376). Only written when the text changes so a
    // drag doesn't hit the store every frame.
    const hint = result.snappedToConnection
      ? `Connection snap active (${result.movingConnCount} candidate conn(s))`
      : result.movingConnCount === 0
        ? 'Connection snap: no free connections in selection'
        : `Connection snap: ${result.movingConnCount} moving conn(s), no target in reach`;
    if (hint !== snapHintRef.current) {
      snapHintRef.current = hint;
      useEditorStore.getState().showStatusMessage(hint, 1500);
    }

    // Drag-out-to-delete cursor hint — port of MapView.cpp:584-587.
    const container = stage?.container();
    if (container) {
      const stageW = stage!.width();
      const stageH = stage!.height();
      const out = !ptr || ptr.x < 0 || ptr.y < 0 || ptr.x >= stageW || ptr.y >= stageH;
      container.style.cursor = out ? 'not-allowed' : '';
    }
  }

  function handleDragEnd(e: KonvaEventObject<DragEvent>) {
    const wasSnapped = useEditorStore.getState().liveSnap !== null;
    useEditorStore.getState().setLiveSnap(null);
    snapHintRef.current = null;
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = '';
    // Clear the multi-brick snapshot so the next single-brick drag
    // starts clean.
    const dragStart = dragStartRef.current;
    const snappedOrientation = snapOrientRef.current;
    dragStartRef.current = null;
    snapOrientRef.current = null;
    const annoNodes = annoNodesRef.current;
    annoNodesRef.current = [];
    restoreNodes(annoNodes);
    grabConnRef.current = -1;
    if (isViewer) return;
    if (tool !== 'select') return;
    void dragStart;
    const map = getMap();
    const { selection, annoSelection } = useEditorStore.getState();
    const inSelection = selection.includes(brick.id);
    // Rulers / labels ride along only when they were captured at drag start.
    const anno = annoNodes.length > 0 ? annoSelection : { rulers: [], labels: [], texts: [] };

    // Drag-out-of-viewport-to-delete — port of MapView.cpp:725-736.
    // If the user released the mouse outside the Konva stage rect
    // (typically over the parts panel or browser chrome), interpret it
    // as a delete rather than a move.
    const stage = e.target.getStage();
    const ptr = stage?.getPointerPosition();
    const stageW = stage?.width() ?? 0;
    const stageH = stage?.height() ?? 0;
    const outOfBounds =
      !ptr || ptr.x < 0 || ptr.y < 0 || ptr.x >= stageW || ptr.y >= stageH;
    if (outOfBounds) {
      // Desktop deleteSelected() removes the whole selection — bricks on
      // any layer plus rulers, labels and text — in one undo step.
      if (inSelection) {
        deleteMixedSelection(doc, map, selection, annoSelection);
      } else {
        deleteMixedSelection(doc, map, [brick.id], { rulers: [], labels: [], texts: [] });
      }
      useEditorStore.getState().setSelection([]);
      // Snap the visible Group back to its original position so it
      // doesn't briefly render at the off-stage drop coords before the
      // Yjs delete propagates.
      const node = e.target;
      node.position({ x: pivot.x * studToPx(), y: pivot.y * studToPx() });
      return;
    }

    const newCentreStudX = e.target.x() / studToPx();
    const newCentreStudY = e.target.y() / studToPx();
    const oldCentreStudX = pivot.x;
    const oldCentreStudY = pivot.y;
    const dx = newCentreStudX - oldCentreStudX;
    const dy = newCentreStudY - oldCentreStudY;
    const sidecar = annoCount(anno) > 0 ? readSidecarFromDoc(doc) : null;
    const labels = sidecar?.anchoredLabels ?? [];
    const modules = sidecar?.modules ?? [];

    if (inSelection && selection.length > 1) {
      // Multi-select drag: translate every selected brick (and ruler /
      // label) by the same delta, across ALL layers in one transaction
      // so undo is one step.
      translateMixedSelection(doc, map, labels, modules, { bricks: selection, anno, dx, dy });
    } else {
      // Single brick: commit its snapped pose, plus any rulers / labels
      // selected with it, as one undo step.
      doc.transact(() => {
        if (snappedOrientation !== null) {
          moveBrickAndOrient(doc, layerId, brick.id, newCentreStudX, newCentreStudY, snappedOrientation, meta);
        } else {
          moveBrick(doc, layerId, brick.id, newCentreStudX, newCentreStudY, meta);
        }
        if (annoCount(anno) > 0) {
          translateMixedSelection(doc, map, labels, modules, { bricks: [], anno, dx, dy, movedBricks: [brick.id] });
        }
      }, LOCAL_ORIGIN);
    }
    // Desktop confirms the commit in the status bar (MapViewDrag.cpp:594-597).
    useEditorStore.getState().showStatusMessage(wasSnapped ? 'Connection snap' : 'Moved', 1500);
  }

  return (
    <Group
      ref={groupRef}
      // Stable name so multi-brick drag can find sibling Groups via
      // `stage.findOne('.brick-<id>')` and translate them in step.
      name={`brick-${brick.id}`}
      x={studToPx(pivot.x)}
      y={studToPx(pivot.y)}
      rotation={brick.orientation}
      draggable={!isViewer && (tool === 'select')}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={(e) => {
        e.cancelBubble = true;
        // A double-click that bent a flex chain doesn't open properties.
        if (flexMovedRef.current) {
          flexMovedRef.current = false;
          return;
        }
        if (!isViewer && onEditBrick) onEditBrick(brick, layerId, meta);
      }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {sprite ? (
        // Sprite is centred on (0,0) of the rotated Group; size is the
        // sprite's natural pixels, NOT the displayArea AABB. This keeps
        // a 45°-rotated 16x4 brick at its real 16x4 footprint (just
        // rotated) instead of stretching it into the AABB envelope.
        //
        // `listening` MUST be true here (or on some other shape in this
        // Group) — Konva hit-tests against an offscreen per-Layer hit
        // canvas that non-listening shapes never paint onto, and a
        // Group has no hit area of its own beyond the union of its
        // listening children's. With every shape in this Group at
        // `listening={false}`, the brick's `draggable` Group had no hit
        // area at all: clicking directly on a brick's own pixels never
        // registered a hit, so selecting/dragging bricks didn't work.
        <KonvaImage
          image={sprite}
          x={-spriteWpx / 2}
          y={-spriteHpx / 2}
          width={spriteWpx}
          height={spriteHpx}
          opacity={1}
          perfectDrawEnabled={false}
        />
      ) : (
        <Rect
          name={meta ? 'brick-loading' : 'brick-unresolved'}
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          // A part the library doesn't know: desktop's placeholder, a dashed
          // red outline over a translucent pink fill (SceneBuilder.cpp:230-242).
          // A known part whose sprite is still loading: a neutral box.
          {...(meta
            ? { fill: '#404040', stroke: '#888' }
            : { fill: 'rgba(255,200,200,0.314)', stroke: 'rgb(200,80,80)', dash: [4, 2], strokeScaleEnabled: false })}
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
      )}
      {/*
        Connection-point dots — port of SceneBuilder.cpp:238-310.
        Free (unlinked) CPs of a selected brick, or of every brick when
        Always Show Connections or the Connection Points view toggle is on
        (both off by default); brightness varies by selection state. Linked CPs render nothing — connectivity rebuild
        (Connectivity.cpp) links coincident CPs, preventing stacked dots
        at shared edges. The active CP gets bigger + gold when selected.
      */}
      {(showConnectionPoints || isSelected || alwaysShowConnections) && meta && meta.connections.map((cp, ci) => {
        // Skip non-numeric "type" values (custom non-snap joints) — same
        // gate desktop applies at SceneBuilder.cpp:262-267.
        if (!cp.type || !/^\d+$/.test(cp.type)) return null;
        const link = brick.connexions[ci];
        if (link && link.linkedTo !== '') return null;
        const isActive = isSelected && ci === brick.activeConnectionPointIndex;
        // `alwaysShowConnections` renders unselected CPs at full brightness
        // (desktop `appearance/alwaysShowConnections`).
        const effectiveSelected = isSelected || alwaysShowConnections;
        const r = isActive ? 13 : 10;
        return (
          <Circle
            key={`cp-${ci}`}
            name={EXPORT_HIDE}
            x={cp.x * 8}
            y={cp.y * 8}
            radius={r}
            fill={isActive ? 'rgb(255,215,0)' : effectiveSelected ? 'rgb(230,40,40)' : 'rgba(200,30,30,0.45)'}
            stroke={isActive ? 'rgb(30,30,30)' : effectiveSelected ? 'rgb(255,255,255)' : 'rgba(255,255,255,0.3)'}
            strokeWidth={isActive ? 3 : 2.5}
            strokeScaleEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
      {isSelected && (
        // Two-stroke gold halo, port of SelectionOverlay::paint
        // (ui/SelectionOverlay.cpp:21-48):
        //   - 5px black outer outline (visible on light backgrounds)
        //   - 2.5px inner gold outline + translucent gold fill
        // Sized to the sprite's natural footprint so the halo follows
        // the rotated brick's silhouette rather than the AABB.
        <>
          <Rect
            name={EXPORT_HIDE}
            x={-spriteWpx / 2 - 1}
            y={-spriteHpx / 2 - 1}
            width={spriteWpx + 2}
            height={spriteHpx + 2}
            stroke="rgba(0,0,0,0.9)"
            strokeWidth={5}
            strokeScaleEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
            fillEnabled={false}
          />
          <Rect
            name={EXPORT_HIDE}
            x={-spriteWpx / 2 - 1}
            y={-spriteHpx / 2 - 1}
            width={spriteWpx + 2}
            height={spriteHpx + 2}
            stroke={selectionHalo(selectionTint, snapActive).stroke}
            strokeWidth={2.5}
            strokeScaleEnabled={false}
            fill={selectionHalo(selectionTint, snapActive).fill}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      )}
      {/* Hull outline — per-layer hullProperties; drawn when view/brickHulls is on
          OR when the layer's own hullProperties.isVisible flag is set.
          When meta.hullPts is non-empty we draw the actual polygon (pixel coords
          relative to sprite top-left, shifted to the Group's local centre).
          Fallback: sprite bounding rect (desktop behaviour for parts without a
          hull element in the XML). */}
      {showHull && (() => {
        const color = hullColor;
        const sw = Math.max(1, hullThickness);
        const pts = meta?.hullPts;
        if (pts && pts.length >= 3) {
          // Flatten to Konva points array: [x0,y0, x1,y1, ...]
          // Translate from sprite-top-left coords to Group local (centred) coords.
          const ox = -spriteWpx / 2;
          const oy = -spriteHpx / 2;
          const flatPts = pts.flatMap((p) => [p.x + ox, p.y + oy]);
          return (
            <Line
              points={flatPts}
              closed
              stroke={color}
              strokeWidth={sw}
              strokeScaleEnabled={false}
              fillEnabled={false}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        }
        return (
          <Rect
            x={-spriteWpx / 2}
            y={-spriteHpx / 2}
            width={spriteWpx}
            height={spriteHpx}
            stroke={color}
            strokeWidth={sw}
            strokeScaleEnabled={false}
            fillEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })()}
      {/* Elevation badge — shows brick.altitude when view/brickElevation is on
          OR when the layer's displayBrickElevation flag is set.
          Port of SceneBuilder.cpp elevation label (brickElevation key).
          Only shown for non-zero altitude so the canvas stays clean. */}
      {showElevation && brick.altitude !== 0 && (
        <KonvaText
          x={-spriteWpx / 2 + 2}
          y={-spriteHpx / 2 + 2}
          text={`${brick.altitude > 0 ? '+' : ''}${brick.altitude}`}
          fontSize={9}
          fontStyle="bold"
          fill="#fff"
          stroke="#000"
          strokeWidth={2}
          fillAfterStrokeEnabled
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
});

function hullColorToCss(c: import('@cld/model').ColorSpec): string {
  if (c.kind === 'known') {
    const known: Record<string, string> = {
      black: '#000', white: '#fff', red: '#f00', green: '#0f0',
      blue: '#00f', yellow: '#ff0', orange: '#ffa500', gray: '#808080',
      darkgray: '#a9a9a9', lightgray: '#d3d3d3',
    };
    return known[c.name.toLowerCase()] ?? '#000';
  }
  if (c.argb.length === 8) return `#${c.argb.slice(2)}`;
  return `#${c.argb}`;
}

// Mutation helpers (deleteBricks, moveBrick, translateBricks) live in
// `../mutations.ts`, where they're exercised by mutations.test.ts.

/**
 * Walk the map and return every brick id sharing the given `myGroup`.
 * Empty groupId returns an empty list.
 */
function collectGroupMembers(map: BbmMap, groupId: string): string[] {
  if (!groupId) return [];
  const out: string[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      if (b.myGroup === groupId) out.push(b.id);
    }
  }
  return out;
}

/**
 * Selection halo colours: the selection tint, or desktop's green while a
 * connection snap is live (SelectionOverlay.cpp:26-29).
 */
export function selectionHalo(tint: string, snapActive: boolean): { stroke: string; fill: string } {
  return snapActive
    ? { stroke: 'rgb(80,255,120)', fill: 'rgba(80,255,120,0.353)' }
    : { stroke: `#${tint}`, fill: `#${tint}4D` };
}
