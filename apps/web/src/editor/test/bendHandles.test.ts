// Bend handles (render/BendHandles.tsx): a selected flex track's run gets a
// handle on each free end, and dragging one bends the whole run — the
// desktop's MapViewTest.ABendHandleOnTheFreeEndBendsTheWholeRun.

import { afterEach, describe, expect, it } from 'vitest';
import type Konva from 'konva';
import type { LayerBrick } from '@cld/model';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import type { PartWire } from '../../api';
import { insertBricks } from '../mutations';
import { catalogFromParts, recomputeConnectivity } from '../useConnectivity';
import { startFlexSession } from '../flexSession';
import { flexRunEnds } from '../render/BendHandles';
import { useEditorStore } from '../editorStore';

const half = (key: string, connections: unknown[]) =>
  ({ key, partNumber: key.split('.')[0], colorCode: '8', kind: 'leaf', pxPerStud: 8, hullPts: [], connections, subparts: [] }) as unknown as PartWire;
// 88492.8 / 88493.8 from BlueBrickParts (studs).
const FEMALE = half('88492.8', [
  { type: '1', x: -1.15, y: 0, angle: 180, electricPlug: 0 },
  { type: 'flexpivot', x: 0.85, y: 0, angle: 0, electricPlug: 0 },
]);
const MALE = half('88493.8', [
  { type: '1', x: 1.25, y: 0, angle: 0, electricPlug: 0 },
  { type: 'flexpivot', x: -0.75, y: 0, angle: 180, electricPlug: 0 },
]);
const PARTS = new Map([FEMALE, MALE].map((p) => [p.key, p]));

/** Two flex track sets end to end (set origins at x = 0 and 4). */
function twoSets() {
  const doc = createDefaultLayoutDoc();
  const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
  const area = (cx: number) => ({ x: cx - 1.15, y: -2, width: 2.3, height: 4 });
  const ids = insertBricks(doc, layerId, [
    { partNumber: '88492.8', displayArea: area(-0.8) },
    { partNumber: '88493.8', displayArea: area(0.8) },
    { partNumber: '88492.8', displayArea: area(3.2) },
    { partNumber: '88493.8', displayArea: area(4.8) },
  ]);
  recomputeConnectivity(doc, catalogFromParts([FEMALE, MALE]));
  return { doc, layerId, ids };
}
const layerOf = (doc: ReturnType<typeof twoSets>['doc']) => docToBbm(doc).layers.find((l): l is LayerBrick => l.type === 'brick')!;

// A stage whose pointer we move by hand.
let pointer: { x: number; y: number } | null = null;
const handlers = new Map<string, (e?: unknown) => void>();
const stage = {
  on: (name: string, fn: (e?: unknown) => void) => handlers.set(name, fn),
  off: () => undefined,
  getPointerPosition: () => pointer,
  getAbsoluteTransform: () => ({ copy: () => ({ invert: () => ({ point: (p: { x: number; y: number }) => p }) }) }),
  findOne: () => undefined,
  batchDraw: () => undefined,
} as unknown as Konva.Stage;

afterEach(() => {
  handlers.clear();
  pointer = null;
  useEditorStore.getState().setSelection([]);
});

describe('bend handles', () => {
  it('sit on the free ends of the whole run of the selected set', () => {
    const { doc, ids } = twoSets();
    const ends = flexRunEnds(docToBbm(doc), [ids[0]!], PARTS);
    expect(ends.map((e) => Math.round(e.world.x * 100) / 100).sort((a, b) => a - b)).toEqual([-1.95, 6.05]);
    expect([...ends[0]!.run].sort()).toEqual([...ids].sort());
  });

  it('give none to a run joined at both ends, or to rigid track', () => {
    const { doc, ids } = twoSets();
    expect(flexRunEnds(docToBbm(doc), [], PARTS)).toEqual([]);
    const straight = new Map([...PARTS, ['straight.8', half('straight.8', [{ type: '1', x: -8, y: 0, angle: 180 }, { type: '1', x: 8, y: 0, angle: 0 }])]]);
    insertBricks(doc, layerOf(doc).id, [
      { partNumber: 'straight.8', displayArea: { x: -9.95 - 8, y: -4, width: 16, height: 8 } },
      { partNumber: 'straight.8', displayArea: { x: 6.05, y: -4, width: 16, height: 8 } },
    ]);
    recomputeConnectivity(doc, catalogFromParts([...straight.values()]));
    expect(flexRunEnds(docToBbm(doc), [ids[0]!], straight)).toEqual([]);
  });

  it('bend the run as the end is dragged, the far end staying put', () => {
    const { doc, layerId, ids } = twoSets();
    const end = flexRunEnds(docToBbm(doc), [ids[0]!], PARTS).find((e) => e.world.x > 5)!;
    const before = layerOf(doc).bricks;
    const started = startFlexSession({
      stage,
      doc,
      map: docToBbm(doc),
      layerId,
      grabbedId: end.brickId,
      chain: end.run,
      activeConnection: end.connection,
      mouseStuds: end.world,
      partsByKey: PARTS,
      label: 'Bend flex track',
      onEnd: () => undefined,
    });
    expect(started).toBe(true);
    for (const p of [{ x: 6, y: -0.5 }, { x: 5.8, y: -1.5 }]) {
      pointer = { x: p.x * 8, y: p.y * 8 };
      handlers.get('mousemove.flex touchmove.flex')!();
    }
    handlers.get('mouseup.flex touchend.flex')!();
    const after = layerOf(doc).bricks;
    expect(after[0]!.displayArea).toEqual(before[0]!.displayArea);
    expect(after[3]!.orientation).not.toBe(before[3]!.orientation);
    expect(useEditorStore.getState().statusMessage).toBe('Bend flex track');
  });
});
