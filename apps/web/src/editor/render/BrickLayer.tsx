import { useEffect, useRef, useState } from 'react';
import { Circle, Group, Image as KonvaImage, Line, Rect, Text as KonvaText } from 'react-konva';
import * as Y from 'yjs';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import { useQuery } from '@tanstack/react-query';
import { api, spriteUrlFor, type PartWire } from '../../api';
import { useEditorStore } from '../editorStore';
import { deleteBricks, moveBrick, moveBrickAndOrient, translateBricks, translateBricksAcrossLayers } from '../mutations';
import { studToPx } from './coords';
import { ensureSprite, getSpriteSync } from './spriteCache';
import { liveDragSnap } from '../snap';

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  /** When true, the canvas is read-only (no drag, no delete-on-click). */
  isViewer?: boolean;
  /** Double-click → open per-brick properties dialog. */
  onEditBrick?: (brick: Brick, layerId: string, meta: PartWire | undefined) => void;
}

export function BrickLayer({ map, doc, isViewer = false, onEditBrick }: Props) {
  const catalog = useQuery({
    queryKey: ['parts-catalog'],
    queryFn: api.parts.catalog,
    staleTime: 5 * 60 * 1000,
  });

  // Bricks store the catalog key (`<partNumber>.<colorCode>` lowercased)
  // in their `partNumber` field — that's how desktop CLD writes the .bbm.
  // Index by `key` so the lookup matches without a parse step. Fall back
  // to bare `partNumber` for the rare "no colour code" entries (group
  // parts and some custom uploads).
  const partsByKey = new Map<string, PartWire>();
  if (catalog.data) {
    for (const p of catalog.data.parts) {
      partsByKey.set(p.key.toLowerCase(), p);
      if (!partsByKey.has(p.partNumber.toLowerCase())) {
        partsByKey.set(p.partNumber.toLowerCase(), p);
      }
    }
  }

  const brickLayers = map.layers.filter((l): l is LayerBrick => l.type === 'brick');
  return (
    <Group>
      {brickLayers.map((layer) => {
        if (!layer.visible) return null;
        // Apply the per-layer transparency (0-100 → 0..1) on the layer
        // group so every brick inherits it. Mirrors desktop
        // SceneBuilder.cpp:832-834 — `setOpacity(L.transparency/100.0)`.
        const opacity = Math.max(0, Math.min(100, layer.transparency)) / 100;
        return (
          <Group key={layer.id} opacity={opacity}>
            {layer.bricks.map((brick) => (
              <BrickGlyph
                key={brick.id}
                brick={brick}
                layer={layer}
                layerId={layer.id}
                doc={doc}
                meta={partsByKey.get(brick.partNumber.toLowerCase()) ?? lookupByPartNumberOnly(partsByKey, brick.partNumber)}
                isViewer={isViewer}
                map={map}
                partsByKey={partsByKey}
                {...(onEditBrick ? { onEditBrick } : {})}
              />
            ))}
          </Group>
        );
      })}
    </Group>
  );
}

function BrickGlyph({
  brick,
  layer,
  layerId,
  doc,
  meta,
  isViewer,
  map,
  partsByKey,
  onEditBrick,
}: {
  brick: Brick;
  layer: LayerBrick;
  layerId: string;
  doc: Y.Doc;
  isViewer: boolean;
  meta: PartWire | undefined;
  map: BbmMap;
  partsByKey: Map<string, PartWire>;
  onEditBrick?: (brick: Brick, layerId: string, meta: PartWire | undefined) => void;
}) {
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const toggleSelected = useEditorStore((s) => s.toggleSelected);
  const showConnectionPoints = useEditorStore((s) => s.showConnectionPoints);
  const alwaysShowConnections = useEditorStore((s) => s.alwaysShowConnections);
  const showBrickHulls = useEditorStore((s) => s.showBrickHulls);
  const showBrickElevation = useEditorStore((s) => s.showBrickElevation);
  const selectionTint = useEditorStore((s) => s.selectionTint);
  const isSelected = selection.includes(brick.id);
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

  const x = studToPx(brick.displayArea.x);
  const y = studToPx(brick.displayArea.y);
  const w = studToPx(brick.displayArea.width);
  const h = studToPx(brick.displayArea.height);

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
      const groupMembers =
        brick.myGroup && map
          ? collectGroupMembers(map, brick.myGroup)
          : [brick.id];

      if (additive) {
        // Shift/ctrl-click toggles the whole group on/off.
        const sel = new Set(useEditorStore.getState().selection);
        const allIn = groupMembers.every((id) => sel.has(id));
        if (allIn) for (const id of groupMembers) sel.delete(id);
        else for (const id of groupMembers) sel.add(id);
        useEditorStore.getState().setSelection([...sel]);
      } else {
        useEditorStore.getState().setSelection(groupMembers);
      }
    } else if (tool === 'delete' && !isViewer) {
      e.cancelBubble = true;
      deleteBricks(doc, layerId, [brick.id]);
    }
  }

  /**
   * Orientation the snap algorithm last suggested during a live drag.
   * Written each frame in handleDragMove; read in handleDragEnd to commit.
   * Null when no connection snap is active.
   */
  const snapOrientRef = useRef<number | null>(null);

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
        siblings: { id: string; startCentre: { x: number; y: number } }[];
      }
    | null
  >(null);

  function handleDragStart(e: KonvaEventObject<DragEvent>) {
    snapOrientRef.current = null;
    if (isViewer || !map) return;
    if (tool !== 'drag' && tool !== 'select') return;
    // Only the brick under the cursor fires its own onDragStart in
    // Konva; the rest of the selection isn't dragged by Konva itself —
    // we translate them by hand on dragmove.
    const isMulti = selection.length > 1 && selection.includes(brick.id);
    if (!isMulti) {
      dragStartRef.current = null;
      return;
    }
    const sel = new Set(selection);
    const leaderStart = {
      x: brick.displayArea.x + brick.displayArea.width / 2,
      y: brick.displayArea.y + brick.displayArea.height / 2,
    };
    const siblings: { id: string; startCentre: { x: number; y: number } }[] = [];
    for (const layer of map.layers) {
      if (layer.type !== 'brick') continue;
      for (const b of layer.bricks) {
        if (b.id === brick.id || !sel.has(b.id)) continue;
        siblings.push({
          id: b.id,
          startCentre: {
            x: b.displayArea.x + b.displayArea.width / 2,
            y: b.displayArea.y + b.displayArea.height / 2,
          },
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
    if (!meta) return; // can't snap without catalog metadata
    if (tool !== 'drag' && tool !== 'select') return;

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

    const isMulti = dragStartRef.current && dragStartRef.current.siblings.length > 0;
    const movingIds = isMulti
      ? [brick.id, ...dragStartRef.current!.siblings.map((s) => s.id)]
      : [brick.id];

    const result = liveDragSnap(
      {
        part: meta,
        movingId: brick.id,
        movingIds,
        movingLinks: brick.connexions,
        centreX: centreStudX,
        centreY: centreStudY,
        mouseStudX,
        mouseStudY,
        orientation: brick.orientation,
        snapStepStuds: useEditorStore.getState().snapStepStuds,
      },
      map,
      partsByKey,
    );

    // Position the leader at the snapped centre; also rotate it if the
    // connection snap resolved a new orientation (mouth-to-mouth alignment).
    node.position({
      x: result.centreX * studToPx(),
      y: result.centreY * studToPx(),
    });
    snapOrientRef.current = result.newOrientation;
    if (result.newOrientation !== null) {
      node.rotation(result.newOrientation);
    }

    // Translate every other selected brick by the same delta so the
    // group moves rigidly. Match desktop's MapViewDrag.cpp:386-395 —
    // shiftPx applied to every item in dragStart_.
    if (isMulti && stage) {
      const dragStart = dragStartRef.current!;
      const dxStud = result.centreX - dragStart.leaderStartCentre.x;
      const dyStud = result.centreY - dragStart.leaderStartCentre.y;
      for (const sib of dragStart.siblings) {
        const sibNode = stage.findOne(`.brick-${sib.id}`);
        if (sibNode) {
          sibNode.position({
            x: (sib.startCentre.x + dxStud) * studToPx(),
            y: (sib.startCentre.y + dyStud) * studToPx(),
          });
        }
      }
    }

    if (result.snappedToConnection && result.ringStudX !== null) {
      useEditorStore.getState().setLiveSnap({ studX: result.ringStudX, studY: result.ringStudY! });
    } else {
      useEditorStore.getState().setLiveSnap(null);
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
    useEditorStore.getState().setLiveSnap(null);
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = '';
    // Clear the multi-brick snapshot so the next single-brick drag
    // starts clean.
    const dragStart = dragStartRef.current;
    const snappedOrientation = snapOrientRef.current;
    dragStartRef.current = null;
    snapOrientRef.current = null;
    if (isViewer) return;
    if (tool !== 'drag' && tool !== 'select') return;
    void dragStart;

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
      const ids =
        selection.includes(brick.id) && selection.length > 0
          ? selection
          : [brick.id];
      deleteBricks(doc, layerId, ids);
      useEditorStore.getState().setSelection([]);
      // Snap the visible Group back to its original position so it
      // doesn't briefly render at the off-stage drop coords before the
      // Yjs delete propagates.
      const node = e.target;
      node.position({
        x: (brick.displayArea.x + brick.displayArea.width / 2) * studToPx(),
        y: (brick.displayArea.y + brick.displayArea.height / 2) * studToPx(),
      });
      return;
    }

    const newCentreStudX = e.target.x() / studToPx();
    const newCentreStudY = e.target.y() / studToPx();

    if (selection.includes(brick.id) && selection.length > 1) {
      // Multi-select drag: translate every selected brick by the same delta,
      // across ALL layers in one transaction so undo is one step.
      const oldCentreStudX = brick.displayArea.x + brick.displayArea.width / 2;
      const oldCentreStudY = brick.displayArea.y + brick.displayArea.height / 2;
      const dx = newCentreStudX - oldCentreStudX;
      const dy = newCentreStudY - oldCentreStudY;
      const selSet = new Set(selection);
      const byLayer = new Map<string, string[]>();
      for (const layer of map.layers) {
        if (layer.type !== 'brick') continue;
        const ids = layer.bricks.filter((b) => selSet.has(b.id)).map((b) => b.id);
        if (ids.length > 0) byLayer.set(layer.id, ids);
      }
      translateBricksAcrossLayers(doc, byLayer, dx, dy);
    } else if (snappedOrientation !== null) {
      moveBrickAndOrient(doc, layerId, brick.id, newCentreStudX, newCentreStudY, snappedOrientation);
    } else {
      moveBrick(doc, layerId, brick.id, newCentreStudX, newCentreStudY);
    }
  }

  return (
    <Group
      ref={groupRef}
      // Stable name so multi-brick drag can find sibling Groups via
      // `stage.findOne('.brick-<id>')` and translate them in step.
      name={`brick-${brick.id}`}
      x={x + w / 2}
      y={y + h / 2}
      rotation={brick.orientation}
      draggable={!isViewer && (tool === 'drag' || tool === 'select')}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={(e) => {
        e.cancelBubble = true;
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
        <KonvaImage
          image={sprite}
          x={-spriteWpx / 2}
          y={-spriteHpx / 2}
          width={spriteWpx}
          height={spriteHpx}
          opacity={1}
        />
      ) : (
        <Rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          fill="#404040"
          stroke="#888"
          strokeWidth={1}
        />
      )}
      {/*
        Connection-point dots — port of SceneBuilder.cpp:238-289.
        Always shown for free (unlinked) CPs; brightness varies by
        selection state. Linked CPs render nothing — connectivity rebuild
        (Connectivity.cpp) links coincident CPs, preventing stacked dots
        at shared edges. The active CP gets bigger + gold when selected.
      */}
      {showConnectionPoints && meta && meta.connections.map((cp, ci) => {
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
            x={-spriteWpx / 2 - 1}
            y={-spriteHpx / 2 - 1}
            width={spriteWpx + 2}
            height={spriteHpx + 2}
            stroke={`#${selectionTint}`}
            strokeWidth={2.5}
            strokeScaleEnabled={false}
            fill={`#${selectionTint}4D`}
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
      {(showBrickHulls || layer.hullProperties.isVisible) && (() => {
        const hull = layer.hullProperties;
        const color = hullColorToCss(hull.hullColor);
        const sw = Math.max(1, hull.hullThickness);
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
      {(showBrickElevation || layer.displayBrickElevation) && brick.altitude !== 0 && (
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
}

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
 * Last-resort lookup for bricks whose stored `partNumber` doesn't include
 * a colour code (e.g. "BT R104" rather than "BT R104.8"). Walk the catalog
 * for any colour variant of the same partNumber.
 */
function lookupByPartNumberOnly(
  partsByKey: Map<string, PartWire>,
  partNumber: string,
): PartWire | undefined {
  const lower = partNumber.toLowerCase();
  for (const p of partsByKey.values()) {
    if (p.partNumber.toLowerCase() === lower) return p;
  }
  return undefined;
}
