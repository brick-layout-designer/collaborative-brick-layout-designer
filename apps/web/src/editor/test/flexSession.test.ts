// A flex track set (flex.group: a female and a male half joined by a 10°
// hinge) is placed as a module; its double-click must still bend it, unless
// the module is pinned.

import { afterEach, describe, expect, it } from 'vitest';
import type Konva from 'konva';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import type { PartWire } from '../../api';
import { insertSet } from '../mutations';
import { catalogFromParts, recomputeConnectivity } from '../useConnectivity';
import { startFlexSession } from '../flexSession';
import { useEditorStore } from '../editorStore';

const half = (key: string, connections: unknown[]) =>
  ({ key, partNumber: key.split('.')[0], colorCode: '8', kind: 'leaf', pxPerStud: 8, hullPts: [], connections, subparts: [] }) as unknown as PartWire;
// 88492.8 / 88493.8 from BlueBrickParts (connection positions in studs).
const FEMALE = half('88492.8', [
  { type: '1', x: -1.15, y: 0, angle: 180, electricPlug: 0, nextConnexionPreference: 0 },
  { type: 'flexpivot', x: 0.85, y: 0, angle: 0, electricPlug: 0, nextConnexionPreference: 1 },
]);
const MALE = half('88493.8', [
  { type: '1', x: 1.25, y: 0, angle: 0, electricPlug: 0, nextConnexionPreference: 0 },
  { type: 'flexpivot', x: -0.75, y: 0, angle: 180, electricPlug: 0, nextConnexionPreference: 1 },
]);
const PARTS = new Map([FEMALE, MALE].map((p) => [p.key, p]));

const handlers: string[] = [];
const stage = {
  on: (name: string) => handlers.push(name),
  off: () => undefined,
  getPointerPosition: () => null,
  findOne: () => undefined,
  batchDraw: () => undefined,
} as unknown as Konva.Stage;

function placedSet() {
  const doc = createDefaultLayoutDoc();
  const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
  const area = (cx: number) => ({ x: cx - 1.15, y: -2, width: 2.3, height: 4 });
  const [female, male] = insertSet(
    doc,
    layerId,
    [
      { partNumber: '88492.8', displayArea: area(-0.8), orientation: 0 },
      { partNumber: '88493.8', displayArea: area(0.8), orientation: 0 },
    ],
    'Flex Track',
  );
  recomputeConnectivity(doc, catalogFromParts([FEMALE, MALE]));
  return { doc, layerId, female: female!, male: male!, modules: readSidecarFromDoc(doc)?.modules ?? [] };
}

function start(s: ReturnType<typeof placedSet>, pinned: boolean) {
  useEditorStore.getState().setSelection([s.female, s.male]);
  return startFlexSession({
    stage,
    doc: s.doc,
    map: docToBbm(s.doc),
    layerId: s.layerId,
    grabbedId: s.male,
    mouseStuds: { x: 1.8, y: 0 },
    partsByKey: PARTS,
    modules: s.modules.map((m) => ({ ...m, pinned })),
    onEnd: () => undefined,
  });
}

afterEach(() => {
  handlers.length = 0;
  useEditorStore.getState().setSelection([]);
});

describe('flex move of a placed flex track set', () => {
  it('starts on the set although it is a module', () => {
    const s = placedSet();
    expect(s.modules).toHaveLength(1);
    expect(start(s, false)).toBe(true);
    expect(handlers).toContain('mousemove.flex touchmove.flex');
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('never bends a pinned module', () => {
    const s = placedSet();
    expect(start(s, true)).toBe(false);
    expect(handlers).toHaveLength(0);
  });
});
