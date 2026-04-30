import { describe, expect, it } from 'vitest';
import type { BbmMap, Brick, Layer, LayerBrick } from '@cld/model';
import { rebuildConnectivity } from './connectivity.js';
import type { Catalog, PartMetadata } from './types.js';

// Helpers for building synthetic test scenarios. Each part has
// its own connection list; bricks placed at world coordinates.
function makeMeta(
  partNumber: string,
  connections: { x: number; y: number; type: string }[],
): PartMetadata {
  return {
    key: partNumber.toLowerCase(),
    partNumber,
    colorCode: '',
    kind: 'leaf',
    descriptions: {},
    author: '',
    sortingKey: '',
    spritePath: '',
    pxPerStud: 8,
    connections: connections.map((c) => ({
      type: c.type,
      x: c.x,
      y: c.y,
      angle: 0,
      electricPlug: -1,
    })),
    subparts: [],
    canUngroup: true,
    hullPts: [],
  };
}

function makeBrick(id: string, partNumber: string, x: number, y: number, orientation = 0): Brick {
  return {
    id,
    displayArea: { x, y, width: 0, height: 0 }, // size-0 keeps centre at (x, y)
    myGroup: '',
    partNumber,
    orientation,
    activeConnectionPointIndex: 0,
    altitude: 0,
    connexions: [],
  };
}

function makeBrickLayer(bricks: Brick[]): LayerBrick {
  return {
    type: 'brick',
    id: 'L1',
    name: 'L',
    visible: true,
    transparency: 100,
    hullProperties: {
      isVisible: false,
      hullColor: { kind: 'known', name: 'Black' },
      hullThickness: 1,
    },
    displayBrickElevation: false,
    bricks,
    groups: [],
  };
}

function makeMap(layers: Layer[]): BbmMap {
  return {
    version: 9,
    nbItems: layers.reduce(
      (n, l) => n + (l.type === 'brick' ? l.bricks.length : 0),
      0,
    ),
    backgroundColor: { kind: 'known', name: 'White' },
    author: '',
    lug: '',
    event: '',
    date: { day: 1, month: 1, year: 2026 },
    comment: '',
    exportInfo: {
      exportPath: '',
      exportFileType: 0,
      exportArea: { x: 0, y: 0, width: 0, height: 0 },
      exportScale: 1,
      exportWatermark: false,
      exportElectricCircuit: false,
      exportConnectionPoints: false,
    },
    selectedLayerIndex: 0,
    layers,
  };
}

describe('rebuildConnectivity', () => {
  it('links two bricks whose connection points coincide within tolerance', () => {
    // Two straight tracks placed end-to-end. Each has a connection at
    // (-5, 0) and (5, 0) relative to its centre. Brick A at (0, 0),
    // Brick B at (10, 0). The shared coordinate is (5, 0).
    const meta = makeMeta('TRACK', [
      { x: -5, y: 0, type: 'rail' },
      { x: 5, y: 0, type: 'rail' },
    ]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    const a = makeBrick('a', 'TRACK', 0, 0);
    const b = makeBrick('b', 'TRACK', 10, 0);
    const map = makeMap([makeBrickLayer([a, b])]);

    const result = rebuildConnectivity(map, catalog);

    expect(result.linkedCount).toBe(2);
    // Inner endpoints are linked to each other.
    expect(a.connexions[1]?.linkedTo).toBe(b.connexions[0]?.id);
    expect(b.connexions[0]?.linkedTo).toBe(a.connexions[1]?.id);
    // Outer endpoints stay unlinked.
    expect(a.connexions[0]?.linkedTo).toBe('');
    expect(b.connexions[1]?.linkedTo).toBe('');
  });

  it('does not link points whose distance exceeds 1 stud', () => {
    const meta = makeMeta('TRACK', [
      { x: -5, y: 0, type: 'rail' },
      { x: 5, y: 0, type: 'rail' },
    ]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    // 12 studs apart → inner points 2 studs apart → outside tolerance.
    const a = makeBrick('a', 'TRACK', 0, 0);
    const b = makeBrick('b', 'TRACK', 12, 0);
    const map = makeMap([makeBrickLayer([a, b])]);

    const result = rebuildConnectivity(map, catalog);
    expect(result.linkedCount).toBe(0);
  });

  it('does not link points with mismatched types', () => {
    const railMeta = makeMeta('RAIL', [{ x: 0, y: 0, type: 'rail' }]);
    const roadMeta = makeMeta('ROAD', [{ x: 0, y: 0, type: 'road' }]);
    const catalog: Catalog = new Map([
      [railMeta.key, railMeta],
      [roadMeta.key, roadMeta],
    ]);

    const a = makeBrick('a', 'RAIL', 0, 0);
    const b = makeBrick('b', 'ROAD', 0, 0); // coincident, but different type
    const map = makeMap([makeBrickLayer([a, b])]);

    const result = rebuildConnectivity(map, catalog);
    expect(result.linkedCount).toBe(0);
  });

  it('skips connections whose type is empty', () => {
    const meta = makeMeta('NONE', [{ x: 0, y: 0, type: '' }]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    const a = makeBrick('a', 'NONE', 0, 0);
    const b = makeBrick('b', 'NONE', 0, 0);
    const map = makeMap([makeBrickLayer([a, b])]);

    const result = rebuildConnectivity(map, catalog);
    expect(result.linkedCount).toBe(0);
  });

  it('respects orientation when rotating local connection points to world space', () => {
    // Brick A at origin, orientation 0, has a connexion at local (5, 0)
    // → world (5, 0). Brick B at (5, 5), orientation -90° (clockwise 90),
    // has a connexion at local (0, 5) which after −90° rotation is (5, 0)
    // → world (10, 5).  No coincidence here. Now place B with
    // orientation 90° (counter-clockwise) so local (0, 5) becomes (-5, 0)
    // → world (0, 5). Still no match. The point of this test is to confirm
    // the rotation matrix doesn't accidentally match arbitrary points.
    //
    // For the positive case, we use orientation 180°: local (5, 0) →
    // world (5 - 10, 0) = (-5, 0). Place A at (-5, 0) with cp at (0, 0)
    // and the world points coincide.
    const a = makeMeta('A', [{ x: 5, y: 0, type: 'rail' }]);
    const b = makeMeta('B', [{ x: 0, y: 0, type: 'rail' }]);
    const catalog: Catalog = new Map([[a.key, a], [b.key, b]]);

    const ba = makeBrick('a', 'A', 0, 0, 180);
    const bb = makeBrick('b', 'B', -5, 0, 0);
    const map = makeMap([makeBrickLayer([ba, bb])]);

    const result = rebuildConnectivity(map, catalog);
    expect(result.linkedCount).toBe(2);
  });

  it('picks the nearest neighbour when 3 points converge', () => {
    // Three bricks at a junction. Two are very close (0.1 stud apart) and
    // one is at the tolerance edge (just under 1 stud away). The nearest
    // pair must claim each other.
    const meta = makeMeta('TRACK', [{ x: 0, y: 0, type: 'rail' }]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    const a = makeBrick('a', 'TRACK', 0, 0);
    const b = makeBrick('b', 'TRACK', 0.1, 0);
    const c = makeBrick('c', 'TRACK', 0.9, 0);
    const map = makeMap([makeBrickLayer([a, b, c])]);

    rebuildConnectivity(map, catalog);

    // a and b are ~0.1 apart; both should be linked to each other. c stays
    // unlinked because its candidates already paired off.
    expect(a.connexions[0]?.linkedTo).toBe(b.connexions[0]?.id);
    expect(b.connexions[0]?.linkedTo).toBe(a.connexions[0]?.id);
    expect(c.connexions[0]?.linkedTo).toBe('');
  });

  it('grows brick.connexions to match the catalog count', () => {
    const meta = makeMeta('TRACK', [
      { x: 0, y: 0, type: 'rail' },
      { x: 1, y: 0, type: 'rail' },
    ]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    const a = makeBrick('a', 'TRACK', 0, 0); // empty connexions
    const map = makeMap([makeBrickLayer([a])]);

    rebuildConnectivity(map, catalog);

    expect(a.connexions).toHaveLength(2);
    expect(a.connexions[0]?.id).toBeTruthy();
    expect(a.connexions[1]?.id).toBeTruthy();
  });

  it('shrinks brick.connexions when stale entries exceed the catalog count', () => {
    const meta = makeMeta('TRACK', [{ x: 0, y: 0, type: 'rail' }]);
    const catalog: Catalog = new Map([[meta.key, meta]]);

    const a = makeBrick('a', 'TRACK', 0, 0);
    a.connexions = [
      { id: 'a_0', linkedTo: '' },
      { id: 'a_1', linkedTo: 'leftover-link' }, // stale extra
    ];
    const map = makeMap([makeBrickLayer([a])]);

    rebuildConnectivity(map, catalog);

    expect(a.connexions).toHaveLength(1);
  });
});
