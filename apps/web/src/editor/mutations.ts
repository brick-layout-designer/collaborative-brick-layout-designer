// All Yjs doc mutations the editor performs. Pulled out of the React tree
// so the rules (origin-tagging, transaction granularity, brick lookup) can
// be unit-tested directly against a Y.Doc.
//
// Every mutation wraps in `doc.transact(fn, LOCAL_ORIGIN)` so that
// Y.UndoManager configured with `trackedOrigins: new Set([LOCAL_ORIGIN])`
// only walks back transactions originating in this client. Phase 4 will
// distinguish "this user's edits" from "other users' edits" using the
// y-websocket clientID; for Phase 3 single-user, LOCAL_ORIGIN is enough.

import * as Y from 'yjs';
import type { ColorSpec, FontSpec, RectangleF } from '@cld/model';
import { LOCAL_ORIGIN } from './useLayoutDoc';

export interface BrickInsertSpec {
  partNumber: string;
  /** World position in studs (top-left of displayArea). */
  x: number;
  y: number;
  width: number;
  height: number;
  orientation?: number;
  altitude?: number;
}

/** Generate a fresh decimal-numeric brick id derived from current count + ts. */
function makeId(): string {
  // Vanilla BlueBrick ids must be parseable as `ulong`. Combine a timestamp
  // (ms-resolution) with a random tail so IDs are unique even when the
  // editor produces multiple bricks within the same millisecond.
  return `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

export function placeBrick(
  doc: Y.Doc,
  layerId: string,
  spec: BrickInsertSpec,
): string {
  const id = makeId();
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;

    const yBrick = new Y.Map<unknown>();
    yBrick.set('id', id);
    yBrick.set('displayArea', {
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
    } satisfies RectangleF);
    yBrick.set('myGroup', '');
    yBrick.set('partNumber', spec.partNumber);
    yBrick.set('orientation', spec.orientation ?? 0);
    yBrick.set('activeConnectionPointIndex', 0);
    yBrick.set('altitude', spec.altitude ?? 0);
    yBrick.set('connexions', []);
    bricks.push([yBrick]);
  }, LOCAL_ORIGIN);
  return id;
}

export function deleteBricks(doc: Y.Doc, layerId: string, brickIds: string[]): void {
  if (brickIds.length === 0) return;
  doc.transact(() => {
    const layerData = doc.getMap('layerData').get(layerId);
    if (!(layerData instanceof Y.Map)) return;
    const bricks = layerData.get('bricks');
    if (!(bricks instanceof Y.Array)) return;

    const idSet = new Set(brickIds);
    // Walk in reverse so deletions don't shift indices we still need.
    for (let i = bricks.length - 1; i >= 0; i--) {
      const b = bricks.get(i);
      if (b instanceof Y.Map && idSet.has(b.get('id') as string)) {
        bricks.delete(i, 1);
      }
    }
  }, LOCAL_ORIGIN);
}

export function moveBrick(
  doc: Y.Doc,
  layerId: string,
  brickId: string,
  newCentreX: number,
  newCentreY: number,
): void {
  doc.transact(() => {
    const yBrick = findBrick(doc, layerId, brickId);
    if (!yBrick) return;
    const area = yBrick.get('displayArea') as RectangleF;
    yBrick.set('displayArea', {
      ...area,
      x: newCentreX - area.width / 2,
      y: newCentreY - area.height / 2,
    });
  }, LOCAL_ORIGIN);
}

export function rotateBricks(
  doc: Y.Doc,
  layerId: string,
  brickIds: string[],
  deltaDegrees: number,
): void {
  if (brickIds.length === 0 || deltaDegrees === 0) return;
  doc.transact(() => {
    for (const brickId of brickIds) {
      const yBrick = findBrick(doc, layerId, brickId);
      if (!yBrick) continue;
      const current = (yBrick.get('orientation') as number) ?? 0;
      // Snap to integer degrees because the .bbm format prints floats with
      // 7-digit precision; tiny FP drift would alter byte output across
      // saves. Most desktop layouts use integer rotations anyway.
      yBrick.set('orientation', Math.round(current + deltaDegrees) % 360);
    }
  }, LOCAL_ORIGIN);
}

function findBrick(doc: Y.Doc, layerId: string, brickId: string): Y.Map<unknown> | null {
  const layerData = doc.getMap('layerData').get(layerId);
  if (!(layerData instanceof Y.Map)) return null;
  const bricks = layerData.get('bricks');
  if (!(bricks instanceof Y.Array)) return null;
  for (let i = 0; i < bricks.length; i++) {
    const b = bricks.get(i);
    if (b instanceof Y.Map && b.get('id') === brickId) return b;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Initialisers — used when starting from a blank layout and the user does
// their first interaction. We seed minimal defaults for layers / fonts.
// ---------------------------------------------------------------------------

export function ensureBrickLayer(doc: Y.Doc): string {
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');
  for (const id of layerOrder.toArray()) {
    const l = layerData.get(id);
    if (l instanceof Y.Map && l.get('type') === 'brick') return id;
  }
  // No brick layer exists — create one. Include a meta header if the doc
  // is fully empty so docToBbm doesn't trip on a missing version.
  const meta = doc.getMap('meta');
  doc.transact(() => {
    if (meta.get('version') === undefined) seedDefaultMeta(meta);
    const layerId = makeId();
    const yLayer = new Y.Map<unknown>();
    yLayer.set('id', layerId);
    yLayer.set('type', 'brick');
    yLayer.set('name', 'Bricks');
    yLayer.set('visible', true);
    yLayer.set('transparency', 100);
    yLayer.set('hullProperties', {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' } satisfies ColorSpec,
      hullThickness: 1,
    });
    yLayer.set('displayBrickElevation', false);
    yLayer.set('bricks', new Y.Array<Y.Map<unknown>>());
    yLayer.set('groups', new Y.Array<Y.Map<unknown>>());
    layerData.set(layerId, yLayer);
    layerOrder.push([layerId]);
  }, LOCAL_ORIGIN);
  return ensureBrickLayer(doc); // re-resolve the id after the transaction
}

function seedDefaultMeta(meta: Y.Map<unknown>): void {
  const today = new Date();
  meta.set('version', 9);
  meta.set('nbItems', 0);
  meta.set('backgroundColor', { kind: 'known', name: 'White' } satisfies ColorSpec);
  meta.set('author', '');
  meta.set('lug', '');
  meta.set('event', '');
  meta.set('date', {
    day: today.getDate(),
    month: today.getMonth() + 1,
    year: today.getFullYear(),
  });
  meta.set('comment', '');
  meta.set('exportInfo', {
    exportPath: '',
    exportFileType: 4,
    exportArea: { x: 0, y: 0, width: 0, height: 0 },
    exportScale: 0,
    exportWatermark: true,
    exportElectricCircuit: false,
    exportConnectionPoints: false,
  });
  meta.set('selectedLayerIndex', 0);
  void ({} as FontSpec); // type-touch to keep the import alive in case we add cellIndexFont later
}
