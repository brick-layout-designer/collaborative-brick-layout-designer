// Grid snap (gridSnap.ts): the cases the desktop runs too
// (fixtures/grid-snap-vectors.json, from vanilla BlueBrick under Wine), then
// each kind of item: parts (with <SnapMargin>, in sets), new parts, modules.

import { describe, expect, it } from 'vitest';
import type { Brick, LayerBrick } from '@cld/model';
import type { PartWire, SnapMarginWire } from '../../api';
import {
  annoDragShift,
  dragCorner,
  dragShift,
  floorToStep,
  grabSnapCorner,
  roundToStep,
  snapCorner,
  snapOffset,
  snapPoint,
} from '../gridSnap';
import { moduleDropTranslation } from '../moduleDrop';
import { snapPlacement } from '../snap';
import VEC from './fixtures/grid-snap-vectors.json';

type Margin4 = [number, number, number, number];
const marginOf = (m: number[]): SnapMarginWire => {
  const [left, right, top, bottom] = m as Margin4;
  return { left, right, top, bottom };
};

function part(key: string, extra: Partial<PartWire> = {}): PartWire {
  return {
    key,
    partNumber: key,
    colorCode: '',
    kind: 'leaf',
    description: key,
    sortingKey: '',
    spritePath: '',
    pxPerStud: 8,
    category: 'test',
    connections: [],
    subparts: [],
    hullPts: [],
    source: 'bundled',
    customPartId: null,
    ...extra,
  };
}

function brick(id: string, partNumber: string, x: number, y: number, w: number, h: number, extra: Partial<Brick> = {}): Brick {
  return {
    id,
    partNumber,
    displayArea: { x, y, width: w, height: h },
    myGroup: '',
    orientation: 0,
    activeConnectionPointIndex: 0,
    altitude: 0,
    connexions: [],
    ...extra,
  };
}

describe('grid snap: shared cases (grid-snap-vectors.json)', () => {
  it('offsets from <SnapMargin> match BlueBrick at every turn', () => {
    expect(VEC.offsets.length).toBeGreaterThan(0);
    for (const c of VEC.offsets) {
      const got = snapOffset(marginOf(c.margin), c.orientation);
      expect(got.x, JSON.stringify(c)).toBeCloseTo(c.offset[0]!, 5);
      expect(got.y, JSON.stringify(c)).toBeCloseTo(c.offset[1]!, 5);
    }
  });

  it('dragged parts land where BlueBrick puts them', () => {
    const margins = new Map(VEC.offsets.map((o) => [o.part, marginOf(o.margin)]));
    expect(VEC.drags.length).toBeGreaterThan(200);
    for (const c of VEC.drags) {
      const [x, y, w, h] = c.area as Margin4;
      const off = snapOffset(margins.get(c.part), c.orientation);
      const mouse = { x: c.mouse[0]!, y: c.mouse[1]! };
      const raw = { x: x + off.x + mouse.x - c.grab[0]!, y: y + off.y + mouse.y - c.grab[1]! };
      const corner = dragCorner(mouse, raw, c.grid);
      expect(corner.x - off.x + w / 2, JSON.stringify(c)).toBeCloseTo(c.centre[0]!, 3);
      expect(corner.y - off.y + h / 2, JSON.stringify(c)).toBeCloseTo(c.centre[1]!, 3);
    }
  });

  it('points go to the nearest grid point', () => {
    for (const c of VEC.points) {
      const got = snapPoint({ x: c.point[0]!, y: c.point[1]! }, c.grid);
      expect([got.x, got.y], JSON.stringify(c)).toEqual(c.snapped);
    }
  });
});

describe('grid snap: the steps', () => {
  it('halfway goes to the even step', () => {
    expect(roundToStep(12, 8)).toBe(16);
    expect(roundToStep(4, 8)).toBe(0);
    expect(roundToStep(-2.5, 1)).toBe(-2);
    expect(roundToStep(-3.5, 1)).toBe(-4);
    expect(roundToStep(4.01, 8)).toBe(8);
  });

  it('a whole step apart from rounding noise is on the line', () => {
    expect(floorToStep(0.1 + 0.2, 0.1)).toBeCloseTo(0.3, 12);
    expect(floorToStep(-0.5, 1)).toBe(-1);
    expect(dragCorner({ x: 3, y: 3 }, { x: 1.5, y: 1.5 }, 0)).toEqual({ x: 1.5, y: 1.5 });
    expect(dragShift({ x: 3, y: 3 }, { x: 1.5, y: 1.5 }, 0)).toEqual({ x: 0, y: 0 });
    expect(snapPoint({ x: 5.3, y: -5.3 }, 0)).toEqual({ x: 5.3, y: -5.3 });
  });
});

const NINE_V: SnapMarginWire = { left: 0.5, right: 0.5, top: 0, bottom: 0 };

describe('grid snap: parts', () => {
  it('a part snaps by its <SnapMargin> corner', () => {
    const p = part('sm.7', { snapMargin: NINE_V });
    expect(snapCorner(brick('a', 'sm.7', 3.3, 2.2, 17, 8), p)).toEqual({ x: 3.8, y: 2.2 });
    expect(snapCorner(brick('a', 'sm.7', 3.3, 2.2, 8, 17, { orientation: 90 }), p).y).toBeCloseTo(2.7);
    expect(snapCorner(brick('a', 'x', 3.3, 2.2, 17, 8), undefined)).toEqual({ x: 3.3, y: 2.2 });
  });

  it('a part in a set snaps by the set: its box and its margin at its turn', () => {
    const parts = new Map<string, PartWire>([
      ['sm.7', part('sm.7', { snapMargin: NINE_V })],
      ['set.7', part('set.7', { kind: 'group', snapMargin: { left: 1, right: 0, top: 2, bottom: 0 }, subparts: [{ subKey: 'sm.7', x: 0, y: 0, angle: 0 }] })],
    ]);
    const layer: Pick<LayerBrick, 'bricks' | 'groups'> = {
      bricks: [brick('a', 'SM.7', 10, 4, 17, 8, { myGroup: 'g' }), brick('b', 'X', 6, 9, 2, 2, { myGroup: 'g' })],
      groups: [{ id: 'g', partNumber: 'SET.7' }],
    };
    // The box (6, 4); the set unturned: (1, 2) in.
    expect(grabSnapCorner(layer, layer.bricks[0]!, parts)).toEqual({ x: 7, y: 6 });
    // Turned a quarter: the set's margin turns with it.
    const turned = { ...layer, bricks: layer.bricks.map((b) => ({ ...b, orientation: 90 })) };
    const c = grabSnapCorner(turned, turned.bricks[0]!, parts);
    expect(c.x).toBeCloseTo(6);
    expect(c.y).toBeCloseTo(5);
    // A user's group (no part number): the part's own corner.
    const mine = { ...layer, groups: [{ id: 'g' }] };
    expect(grabSnapCorner(mine, mine.bricks[0]!, parts)).toEqual({ x: 10.5, y: 4 });
  });

  it('a new part from the list is held by its box and lands by its snap corner', () => {
    const p = part('sm.7', { snapMargin: NINE_V });
    const r = snapPlacement(
      { part: p, centreX: 20.2, centreY: 9.7, orientation: 0, width: 17, height: 8, snapStepStuds: 8, reach: 0 },
      { layers: [] } as never,
      new Map([['sm.7', p]]),
    );
    // Its corner 8 by 4 studs from the cursor: (16 - 8, 8 - 0).
    expect(r.centreX).toBeCloseTo(7.5 + 8.5);
    expect(r.centreY).toBeCloseTo(8 + 4);
  });

  it('a module lands by its part with a connection', () => {
    const track = part('tt.7', { connections: [{ type: '1', x: -2, y: 0, angle: 180, electricPlug: 0 }] });
    const plate = part('sm.7', { snapMargin: NINE_V });
    const parts = new Map([['tt.7', track], ['sm.7', plate]]);
    const batches = [{
      layerName: 'Parts',
      bricks: [
        { partNumber: 'SM.7', displayArea: { x: 0.3, y: 0.3, width: 17, height: 8 } },
        { partNumber: 'TT.7', displayArea: { x: 20.1, y: 1.7, width: 4, height: 2 } },
      ],
    }];
    const t = moduleDropTranslation(batches, { x: 61.3, y: 70.9 }, 8, null, parts);
    expect(20.1 + t.dx).toBeCloseTo(64);
    expect(1.7 + t.dy).toBeCloseTo(64);
  });
});

describe('grid snap: rulers, labels, text and venue corners', () => {
  const free = false;
  it('a ruler is drawn and stretched with its ends on the grid; Alt draws freely', () => {
    expect(snapPoint({ x: 3.3, y: 50.4 }, 8)).toEqual({ x: 0, y: 48 });
    expect(snapPoint({ x: 19.1, y: 44.2 }, 8)).toEqual({ x: 16, y: 48 });
    // Alt: the caller passes step 0.
    expect(snapPoint({ x: 19.1, y: 44.2 }, 0)).toEqual({ x: 19.1, y: 44.2 });
  });

  it('a moved ruler puts its first end on the grid; the rest follows', () => {
    const s = annoDragShift({ moved: { x: 7.3, y: 6.6 }, mouse: null, corner: null, ref: { x: 1.2, y: 41.1 }, step: 8, free });
    expect(1.2 + 7.3 + s.x).toBeCloseTo(8);
    expect(41.1 + 6.6 + s.y).toBeCloseTo(48);
  });

  it('a moved label puts its corner on the grid; Alt moves it freely', () => {
    const s = annoDragShift({ moved: { x: 5, y: -3 }, mouse: null, corner: null, ref: { x: 10.3, y: 30.6 }, step: 8, free });
    expect(10.3 + 5 + s.x).toBeCloseTo(16);
    expect(30.6 - 3 + s.y).toBeCloseTo(24);
    expect(annoDragShift({ moved: { x: 5, y: -3 }, mouse: null, corner: null, ref: { x: 10.3, y: 30.6 }, step: 8, free: true })).toEqual({ x: 0, y: 0 });
    expect(annoDragShift({ moved: { x: 5, y: -3 }, mouse: null, corner: null, ref: { x: 10.3, y: 30.6 }, step: 0, free })).toEqual({ x: 0, y: 0 });
  });

  it('with parts picked too, everything moves as the parts land, Alt or not', () => {
    // The part's snap corner (3.8, 2.2), grabbed at (10, 5), dragged to (27.6, 13.9).
    for (const isFree of [false, true]) {
      const s = annoDragShift({ moved: { x: 17.6, y: 8.9 }, mouse: { x: 27.6, y: 13.9 }, corner: { x: 3.8, y: 2.2 }, ref: null, step: 8, free: isFree });
      expect(3.8 + 17.6 + s.x).toBeCloseTo(24);
      expect(2.2 + 8.9 + s.y).toBeCloseTo(8);
    }
  });

  it('new text is centred, and venue corners drawn, on the grid', () => {
    expect(snapPoint({ x: 13.1, y: 5.2 }, 8)).toEqual({ x: 16, y: 8 });
    expect([{ x: 3.1, y: 3.3 }, { x: 61, y: 4.6 }, { x: 58.7, y: 45.2 }].map((p) => snapPoint(p, 8))).toEqual([
      { x: 0, y: 0 },
      { x: 64, y: 8 },
      { x: 56, y: 48 },
    ]);
  });
});
