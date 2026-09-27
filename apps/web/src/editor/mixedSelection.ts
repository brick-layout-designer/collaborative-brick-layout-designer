// Mixed selection — bricks together with rulers, anchored labels and
// text cells, like the desktop's Qt scene selection.
//
// Desktop reference:
//   - rubber band / Ctrl+click select any selectable scene item
//     (bricks, ruler pieces, text cells, labels — SceneBuilder.cpp:236,
//     441, 607-644, SceneBuilderSidecar.cpp:113-212)
//   - a drag moves every selected brick, ruler and label, committed as
//     one undo macro (MapViewDrag.cpp:124-153 captureDragStart,
//     412-450 commitDragIfMoved)
//   - arrow nudge moves bricks, rulers and labels (MapView.cpp:985-1041)
//   - Delete removes every selected item (MapView.cpp:2108-2179)
// Text cells are selectable but not movable on desktop (SceneBuilder.cpp:441
// sets ItemIsSelectable only), so drag and nudge leave them in place.
//
// Pure helpers are exported for tests; the two mutations wrap every change
// in ONE LOCAL_ORIGIN transaction so the whole operation is one undo step.

import * as Y from 'yjs';
import type { BbmMap, Brick, RectangleF } from '@cld/model';
import type { AnchoredLabel, SidecarModule } from '@cld/bbm';
import type { AnnoSelection } from './editorStore';
import type { Marquee } from './render/marqueeMath';
import { LOCAL_ORIGIN } from './useLayoutDoc';
import {
  bricksByLayer,
  deleteAnchoredLabel,
  deleteBricksAcrossLayers,
  deleteRulerItem,
  deleteTextCell,
  moveAnchoredLabel,
  moveRulerItem,
  translateBricksAcrossLayers,
} from './mutations';

// ---------------------------------------------------------------------------
// Keys and set helpers
// ---------------------------------------------------------------------------

/** Text cells have no id; they are addressed by layer + index. */
export function textKey(layerId: string, cellIndex: number): string {
  return `${layerId}#${cellIndex}`;
}

export function parseTextKey(key: string): { layerId: string; cellIndex: number } | null {
  const at = key.lastIndexOf('#');
  if (at <= 0) return null;
  const cellIndex = Number(key.slice(at + 1));
  if (!Number.isInteger(cellIndex) || cellIndex < 0) return null;
  return { layerId: key.slice(0, at), cellIndex };
}

export function annoCount(a: AnnoSelection): number {
  return a.rulers.length + a.labels.length + a.texts.length;
}

/** Add `id` to `list`, or remove it when present (Shift/Ctrl+click). */
export function toggleId(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function union(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set(a);
  const out = [...a];
  for (const id of b) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

export function mergeAnno(a: AnnoSelection, b: AnnoSelection): AnnoSelection {
  return {
    rulers: union(a.rulers, b.rulers),
    labels: union(a.labels, b.labels),
    texts: union(a.texts, b.texts),
  };
}

/**
 * Click on an annotation: plain click selects just it (bricks cleared);
 * Shift/Ctrl toggles it and keeps everything else, as Qt does.
 */
export function clickAnno(
  bricks: readonly string[],
  anno: AnnoSelection,
  kind: keyof AnnoSelection,
  id: string,
  additive: boolean,
): { bricks: string[]; anno: AnnoSelection } {
  if (!additive) {
    return { bricks: [], anno: { rulers: [], labels: [], texts: [], [kind]: [id] } };
  }
  return { bricks: [...bricks], anno: { ...anno, [kind]: toggleId(anno[kind], id) } };
}

// ---------------------------------------------------------------------------
// Label geometry (shared with render/AnchoredLabels.tsx)
// ---------------------------------------------------------------------------

export interface LabelIndex {
  brickById: Map<string, Brick>;
  bricksByGroup: Map<string, Brick[]>;
  bricksByModule: Map<string, Brick[]>;
}

export function buildLabelIndex(map: BbmMap, modules: readonly SidecarModule[]): LabelIndex {
  const brickById = new Map<string, Brick>();
  const bricksByGroup = new Map<string, Brick[]>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      brickById.set(b.id, b);
      if (b.myGroup) {
        const arr = bricksByGroup.get(b.myGroup) ?? [];
        arr.push(b);
        bricksByGroup.set(b.myGroup, arr);
      }
    }
  }
  const bricksByModule = new Map<string, Brick[]>();
  for (const mod of modules) {
    const members: Brick[] = [];
    for (const id of mod.members) {
      const b = brickById.get(id);
      if (b) members.push(b);
    }
    if (members.length > 0) bricksByModule.set(mod.id, members);
  }
  return { brickById, bricksByGroup, bricksByModule };
}

/** Bricks a label is anchored to (empty for World labels or a lost target). */
export function labelAnchorBricks(label: AnchoredLabel, index: LabelIndex): Brick[] {
  if (label.kind === 1) {
    const b = index.brickById.get(label.targetId);
    return b ? [b] : [];
  }
  if (label.kind === 2) return index.bricksByGroup.get(label.targetId) ?? [];
  if (label.kind === 3) return index.bricksByModule.get(label.targetId) ?? [];
  return [];
}

/**
 * Anchor point in studs (the leader-line end for Group / Module labels),
 * or null when the anchor is gone and the label is not drawn. World labels
 * anchor at the origin: their offset is their absolute position.
 */
export function labelAnchorStuds(
  label: AnchoredLabel,
  index: LabelIndex,
): { x: number; y: number } | null {
  if (label.kind === 0) return { x: 0, y: 0 };
  const bricks = labelAnchorBricks(label, index);
  if (bricks.length === 0) return null;
  if (label.kind === 1) {
    const b = bricks[0]!;
    return { x: b.displayArea.x + b.displayArea.width / 2, y: b.displayArea.y + b.displayArea.height / 2 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of bricks) {
    minX = Math.min(minX, b.displayArea.x);
    minY = Math.min(minY, b.displayArea.y);
    maxX = Math.max(maxX, b.displayArea.x + b.displayArea.width);
    maxY = Math.max(maxY, b.displayArea.y + b.displayArea.height);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * Approximate text box of a label in studs, for marquee hit-testing.
 * The font size is in world pixels (8 px per stud); width is estimated
 * at 0.6 em per character since text metrics need a canvas.
 */
export function labelBoxStuds(label: AnchoredLabel, index: LabelIndex): RectangleF | null {
  const a = labelAnchorStuds(label, index);
  if (!a) return null;
  const hPx = Math.max(1, label.font.size);
  const wPx = Math.max(1, label.text.length) * hPx * 0.6;
  return { x: a.x + label.offset.x, y: a.y + label.offset.y, width: wPx / 8, height: hPx / 8 };
}

// ---------------------------------------------------------------------------
// Marquee
// ---------------------------------------------------------------------------

function overlaps(m: Marquee, r: RectangleF): boolean {
  const x0 = Math.min(m.x0, m.x1);
  const y0 = Math.min(m.y0, m.y1);
  const x1 = Math.max(m.x0, m.x1);
  const y1 = Math.max(m.y0, m.y1);
  return r.x + r.width >= x0 && r.x <= x1 && r.y + r.height >= y0 && r.y <= y1;
}

/**
 * Rulers, labels and text cells the rubber band touches, on visible
 * layers only (same AABB-overlap rule as `bricksInMarquee`). Labels
 * hidden by their `minZoom` at `zoom` are skipped, as they aren't drawn.
 */
export function annotationsInMarquee(
  marquee: Marquee,
  map: BbmMap,
  labels: readonly AnchoredLabel[],
  modules: readonly SidecarModule[],
  zoom: number,
): AnnoSelection {
  const rulers: string[] = [];
  const texts: string[] = [];
  for (const layer of map.layers) {
    if (!layer.visible) continue;
    if (layer.type === 'ruler') {
      for (const r of layer.rulerItems) if (overlaps(marquee, r.displayArea)) rulers.push(r.id);
    } else if (layer.type === 'text') {
      layer.textCells.forEach((c, i) => {
        if (overlaps(marquee, c.displayArea)) texts.push(textKey(layer.id, i));
      });
    }
  }
  const out: string[] = [];
  if (labels.length > 0) {
    const index = buildLabelIndex(map, modules);
    for (const l of labels) {
      if (l.minZoom > 0 && zoom < l.minZoom) continue;
      const box = labelBoxStuds(l, index);
      if (box && overlaps(marquee, box)) out.push(l.id);
    }
  }
  return { rulers, labels: out, texts };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Layer holding each ruler id. */
function rulerLayers(map: BbmMap, ids: readonly string[]): Map<string, string> {
  const want = new Set(ids);
  const out = new Map<string, string>();
  for (const layer of map.layers) {
    if (layer.type !== 'ruler') continue;
    for (const r of layer.rulerItems) if (want.has(r.id)) out.set(r.id, layer.id);
  }
  return out;
}

/**
 * Labels whose anchor moves with the bricks already follow them, so
 * shifting their offset too would move them twice. A label is skipped
 * when every brick it is anchored to is in `movingBricks`.
 */
export function labelsToOffset(
  labelIds: readonly string[],
  labels: readonly AnchoredLabel[],
  index: LabelIndex,
  movingBricks: ReadonlySet<string>,
): string[] {
  const want = new Set(labelIds);
  const out: string[] = [];
  for (const l of labels) {
    if (!want.has(l.id)) continue;
    const anchors = labelAnchorBricks(l, index);
    if (anchors.length > 0 && anchors.every((b) => movingBricks.has(b.id))) continue;
    out.push(l.id);
  }
  return out;
}

export interface MixedMove {
  bricks: readonly string[];
  anno: AnnoSelection;
  /** Delta for rulers and labels, in studs. */
  dx: number;
  dy: number;
  /** Delta for bricks when it differs (grid snap applied to bricks only). */
  brickDx?: number;
  brickDy?: number;
  /**
   * Bricks the caller moves itself in the same transaction (a single-brick
   * drag commits its own snapped pose). Only used so labels anchored to
   * them are not shifted twice.
   */
  movedBricks?: readonly string[];
}

/**
 * Translate bricks, rulers and labels in one undo step — port of the
 * desktop "Drag" / "Move selection" macros (MapViewDrag.cpp:412-450,
 * MapView.cpp:1033-1041). Text cells stay put.
 */
export function translateMixedSelection(
  doc: Y.Doc,
  map: BbmMap,
  labels: readonly AnchoredLabel[],
  modules: readonly SidecarModule[],
  move: MixedMove,
): void {
  const bdx = move.brickDx ?? move.dx;
  const bdy = move.brickDy ?? move.dy;
  doc.transact(() => {
    if (move.bricks.length > 0) translateBricksAcrossLayers(doc, bricksByLayer(map, move.bricks), bdx, bdy);
    if (move.dx === 0 && move.dy === 0) return;
    for (const [id, layerId] of rulerLayers(map, move.anno.rulers)) {
      moveRulerItem(doc, layerId, id, move.dx, move.dy);
    }
    if (move.anno.labels.length > 0) {
      const moving = new Set<string>(move.movedBricks ?? []);
      if (bdx !== 0 || bdy !== 0) for (const id of move.bricks) moving.add(id);
      const index = buildLabelIndex(map, modules);
      for (const id of labelsToOffset(move.anno.labels, labels, index, moving)) {
        moveAnchoredLabel(doc, id, move.dx, move.dy);
      }
    }
  }, LOCAL_ORIGIN);
}

/** Delete every selected brick, ruler, label and text cell in one undo step. */
export function deleteMixedSelection(
  doc: Y.Doc,
  map: BbmMap,
  bricks: readonly string[],
  anno: AnnoSelection,
): void {
  doc.transact(() => {
    if (bricks.length > 0) deleteBricksAcrossLayers(doc, bricksByLayer(map, bricks));
    for (const [id, layerId] of rulerLayers(map, anno.rulers)) deleteRulerItem(doc, layerId, id);
    for (const id of anno.labels) deleteAnchoredLabel(doc, id);
    // Highest index first per layer so earlier deletions don't shift later ones.
    const cells = anno.texts
      .map(parseTextKey)
      .filter((c): c is { layerId: string; cellIndex: number } => c !== null)
      .sort((a, b) => (a.layerId === b.layerId ? b.cellIndex - a.cellIndex : a.layerId < b.layerId ? -1 : 1));
    for (const c of cells) deleteTextCell(doc, c.layerId, c.cellIndex);
  }, LOCAL_ORIGIN);
}
