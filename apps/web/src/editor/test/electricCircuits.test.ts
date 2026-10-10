// Electric overlay — circuit pairing and polarity propagation across
// linked bricks (port of PartsLibrary.cpp buildElectricCircuits and
// SceneBuilderElectric.cpp).

import { describe, expect, it } from 'vitest';
import type { BbmMap, Brick } from '@cld/model';
import type { PartWire } from '../../api';
import { deriveCircuits, electricOverlay, type ElectricOverlay } from '../render/electricCircuits';

/** Short-circuit marks: the orange strokes (no cutter here). */
const diamonds = (o: ElectricOverlay) => o.strokes.filter((s) => s.color.startsWith('rgba(255,165,0')).length;

type Conn = PartWire['connections'][number];
const conn = (x: number, angle: number, electricPlug: number): Conn => ({ type: '1', x, y: 0, angle, electricPlug });

function part(partNumber: string, connections: Conn[]): PartWire {
  return { partNumber, connections } as unknown as PartWire;
}

// 2865.8-style 9V straight: +1 at one end, -1 at the other.
const STRAIGHT = part('straight', [conn(-8, 180, 1), conn(8, 0, -1)]);
// A wye: one +1 end feeding two -1 ends.
const WYE = part('wye', [conn(-8, 180, 1), conn(8, 0, -1), conn(8, 30, -1)]);

function brick(id: string, partNumber: string, x: number, links: string[]): Brick {
  return {
    id,
    partNumber,
    displayArea: { x, y: 0, width: 16, height: 8 },
    orientation: 0,
    altitude: 0,
    activeConnectionPointIndex: 0,
    connexions: links.map((linkedTo, i) => ({ id: `${id}_c${i}`, linkedTo })),
  } as unknown as Brick;
}

function mapOf(bricks: Brick[]): BbmMap {
  return { layers: [{ type: 'brick', id: 'L', name: 'Tracks', bricks }] } as unknown as BbmMap;
}

const parts = new Map([
  ['straight', STRAIGHT],
  ['wye', WYE],
]);

describe('deriveCircuits', () => {
  it('pairs opposite plugs and ignores 0 (no plug)', () => {
    expect(deriveCircuits(STRAIGHT.connections)).toEqual([{ index1: 0, index2: 1 }]);
    expect(deriveCircuits(WYE.connections)).toEqual([
      { index1: 0, index2: 1 },
      { index1: 0, index2: 2 },
    ]);
    expect(deriveCircuits([conn(-8, 180, 2), conn(8, 0, -2), conn(0, 90, 0)])).toEqual([{ index1: 0, index2: 1 }]);
    expect(deriveCircuits([conn(-8, 180, 0), conn(8, 0, 0)])).toEqual([]);
  });

  it('draws a red and a cyan rail per circuit, 2.5 studs either side', () => {
    const { strokes } = electricOverlay(mapOf([brick('a', 'straight', 0, ['', ''])]), parts);
    expect(strokes.map((l) => l.color)).toEqual(['rgba(255,69,0,1)', 'rgba(0,255,255,1)']);
    // The straight's centre is at y = 4 studs (32 px); the rails 20 px off it.
    expect(strokes.map((l) => l.points[1])).toEqual([52, 12]);
    expect(strokes.every((l) => l.width === 4)).toBe(true); // 0.5 stud
  });

  it('a reversed straight keeps the colors on the same rails', () => {
    // b is turned round: its +1 end meets a's -1 end, so polarity flows in
    // through b's second connection and its colors swap back.
    const a = brick('a', 'straight', 0, ['', 'b_c1']);
    const b = { ...brick('b', 'straight', 16, ['', 'a_c1']), orientation: 180 } as Brick;
    const { strokes } = electricOverlay(mapOf([a, b]), parts);
    const redY = strokes.filter((l) => l.color.startsWith('rgba(255,69,0')).map((l) => Math.round(l.points[1]!));
    expect(redY).toEqual([52, 52]);
  });

  it('a circuit cutter breaks its second rail with two orange bars', () => {
    const cutterParts = new Map([['862ac01.7', part('862AC01', STRAIGHT.connections)]]);
    const { strokes } = electricOverlay(mapOf([brick('c', '862AC01.7', 0, ['', ''])]), cutterParts);
    expect(strokes.map((l) => l.color)).toEqual([
      'rgba(255,69,0,1)',
      'rgba(0,255,255,1)',
      'rgba(0,255,255,1)',
      'rgba(255,165,0,1)',
      'rgba(255,165,0,1)',
    ]);
    // The second rail stops 5.625 studs from each end.
    expect(strokes[1]!.points.at(-2)).toBeCloseTo(5.625 * 8);
    expect(strokes[2]!.points[0]).toBeCloseTo((16 - 5.625) * 8);
  });

  it('follows a hidden layer\'s visibility and a layer\'s opacity', () => {
    const half = { layers: [{ type: 'brick', id: 'L', visible: true, transparency: 50, bricks: [brick('a', 'straight', 0, ['', ''])] }] } as unknown as BbmMap;
    expect(electricOverlay(half, parts).strokes[0]!.color).toBe(`rgba(255,69,0,${127 / 255})`);
    const hidden = { layers: [{ ...half.layers[0], visible: false }] } as unknown as BbmMap;
    expect(electricOverlay(hidden, parts).strokes).toEqual([]);
  });
});

describe('polarity propagation through linked connections', () => {
  it('a wye looped back through a straight is flagged as a short circuit', () => {
    // wye.c1 ↔ s.c0 and s.c1 ↔ wye.c2: both wye outputs feed the straight,
    // one from each end, so its two ends get the same polarity.
    const wye = brick('w', 'wye', 0, ['', 's_c0', 's_c1']);
    const s = brick('s', 'straight', 16, ['w_c1', 'w_c2']);
    expect(diamonds(electricOverlay(mapOf([wye, s]), parts))).toBeGreaterThan(0);
  });

  it('the same bricks unlooped have no short circuit', () => {
    const wye = brick('w', 'wye', 0, ['', 's_c0', '']);
    const s = brick('s', 'straight', 16, ['w_c1', '']);
    expect(diamonds(electricOverlay(mapOf([wye, s]), parts))).toBe(0);
  });
});

describe('the export choice (<ExportElectricCircuit>)', () => {
  it('is remembered in the map, not as an undo step', async () => {
    const Y = await import('yjs');
    const { createDefaultLayoutDoc, docToBbm } = await import('@cld/ydoc');
    const { setExportElectricCircuit } = await import('../mutations');
    const { LOCAL_ORIGIN } = await import('../useLayoutDoc');
    const doc = createDefaultLayoutDoc();
    const um = new Y.UndoManager([doc.getMap('meta')], { trackedOrigins: new Set([LOCAL_ORIGIN]) });
    setExportElectricCircuit(doc, true);
    expect(docToBbm(doc).exportInfo.exportElectricCircuit).toBe(true);
    expect(um.undoStack.length).toBe(0);
  });
});
