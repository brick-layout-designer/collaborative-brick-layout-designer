// Electric overlay — circuit pairing and polarity propagation across
// linked bricks (port of PartsLibrary.cpp buildElectricCircuits and
// SceneBuilderElectric.cpp).

import { describe, expect, it } from 'vitest';
import type { BbmMap, Brick } from '@cld/model';
import type { PartWire } from '../../api';
import { deriveCircuits, electricOverlay } from '../render/electricCircuits';

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

  it('draws a red and a cyan rail per circuit', () => {
    const { lines } = electricOverlay(mapOf([brick('a', 'straight', 0, ['', ''])]), parts);
    expect(lines.map((l) => l.color)).toHaveLength(2);
    expect(new Set(lines.map((l) => l.color)).size).toBe(2);
  });
});

describe('polarity propagation through linked connections', () => {
  it('a wye looped back through a straight is flagged as a short circuit', () => {
    // wye.c1 ↔ s.c0 and s.c1 ↔ wye.c2: both wye outputs feed the straight,
    // one from each end, so its two ends get the same polarity.
    const wye = brick('w', 'wye', 0, ['', 's_c0', 's_c1']);
    const s = brick('s', 'straight', 16, ['w_c1', 'w_c2']);
    expect(electricOverlay(mapOf([wye, s]), parts).diamonds.length).toBeGreaterThan(0);
  });

  it('the same bricks unlooped have no short circuit', () => {
    const wye = brick('w', 'wye', 0, ['', 's_c0', '']);
    const s = brick('s', 'straight', 16, ['w_c1', '']);
    expect(electricOverlay(mapOf([wye, s]), parts).diamonds).toEqual([]);
  });
});
