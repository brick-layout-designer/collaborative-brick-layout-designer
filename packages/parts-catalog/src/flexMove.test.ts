// Flex move against vanilla BlueBrick's own (desktop fixtures/bluebrick-
// oracle/flex-*.bbm, made from flex-in.bbm: a straight, a PFS flex track
// end, eight middles, an end) — desktop FlexMoveTest.cpp, ported. Needs
// <repo>/parts-library; skipped without it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import { rebuildConnectivity } from './connectivity.js';
import { connectionHingeAngle, FlexMove } from './flexMove.js';
import { scanCatalog } from './scan.js';
import type { Catalog } from './types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PARTS = resolve(ROOT, 'parts-library/parts');
const oracle = (name: string) => readBbm(readFileSync(resolve(ROOT, 'packages/bbm/tests/fixtures/oracle', name), 'utf8')).map;
const brickLayer = (map: BbmMap) => map.layers.find((l): l is LayerBrick => l.type === 'brick')!;
const centre = (b: Brick) => ({ x: b.displayArea.x + b.displayArea.width / 2, y: b.displayArea.y + b.displayArea.height / 2 });

describe('connectionHingeAngle (ConnectionTypeList.xml)', () => {
  it('knows the hinged connection types', () => {
    expect(['flexpivot', 'magnet', 'threequarterhinge', 'halfhinge', '1', ''].map(connectionHingeAngle)).toEqual([10, 37, 90, 45, 0, 0]);
  });
});

describe.skipIf(!existsSync(PARTS))('flex move matches vanilla BlueBrick', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    catalog = (await scanCatalog(PARTS)).catalog;
  }, 60_000);

  function expectLikeVanilla(expected: string, grabbed: string, grab: { x: number; y: number }, targets: { x: number; y: number }[]) {
    const map = oracle('flex-in.bbm');
    rebuildConnectivity(map, catalog);
    const layer = brickLayer(map);
    const flex = FlexMove.start(layer, new Set(layer.bricks.map((b) => b.id)), grabbed, grab, catalog);
    expect(flex).not.toBeNull();
    for (const t of targets) flex!.moveTo(t, 0, false);

    const theirs = new Map(brickLayer(oracle(expected)).bricks.map((b) => [b.id, b]));
    let moved = 0;
    for (const b of layer.bricks) {
      const v = theirs.get(b.id)!;
      const what = `${b.id} ${b.partNumber}`;
      expect(Math.abs(centre(b).x - centre(v).x), what).toBeLessThan(0.02);
      expect(Math.abs(centre(b).y - centre(v).y), what).toBeLessThan(0.02);
      expect(Math.abs(b.displayArea.width - v.displayArea.width), what).toBeLessThan(0.02);
      const dOrient = ((b.orientation - v.orientation) % 360 + 540) % 360 - 180;
      expect(Math.abs(dOrient), what).toBeLessThan(0.05);
      if (Math.abs(v.orientation) > 0.01 && Math.abs(v.orientation - 180) > 0.01) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  }

  it('drag the free end in one go (flex-a)', () => {
    expectLikeVanilla('flex-a.bbm', '6887642994309303552', { x: 68, y: 40 }, [{ x: 62, y: 30 }]);
  });

  it('drag the free end along a path (flex-b)', () => {
    expectLikeVanilla('flex-b.bbm', '6887642994309303552', { x: 68, y: 40 }, [
      { x: 67, y: 38 }, { x: 65, y: 34 }, { x: 62, y: 30 }, { x: 58, y: 28 },
    ]);
  });

  it('grab a middle piece (flex-c)', () => {
    expectLikeVanilla('flex-c.bbm', '5048093428964172125', { x: 61.25, y: 40 }, [{ x: 61, y: 35 }]);
  });

  it('rigid track is not flexible', () => {
    const map = oracle('flex-in.bbm');
    rebuildConnectivity(map, catalog);
    const straight = '186617953428535140';
    expect(FlexMove.start(brickLayer(map), new Set([straight]), straight, { x: 40, y: 40 }, catalog)).toBeNull();
  });

  it('restore puts the chain back', () => {
    const map = oracle('flex-in.bbm');
    rebuildConnectivity(map, catalog);
    const layer = brickLayer(map);
    const before = layer.bricks.map((b) => ({ area: { ...b.displayArea }, orientation: b.orientation }));
    const flex = FlexMove.start(layer, new Set(layer.bricks.map((b) => b.id)), '6887642994309303552', { x: 68, y: 40 }, catalog)!;
    flex.moveTo({ x: 62, y: 30 }, 4);
    flex.restore();
    layer.bricks.forEach((b, i) => {
      expect(b.displayArea).toEqual(before[i]!.area);
      expect(b.orientation).toBe(before[i]!.orientation);
    });
  });
});

describe('flex move on a synthetic chain (always runs)', () => {
  // A rigid straight (connections '1') joined to three flex pieces whose
  // joints are 'flexpivot' hinges of 10°: s — f1 — f2 — f3 (free end).
  const part = (key: string, a: string, b: string) => ({
    key, partNumber: key, colorCode: '', kind: 'leaf' as const, descriptions: {}, author: '', sortingKey: '', spritePath: '',
    pxPerStud: 8, spriteSize: { w: 32, h: 16 }, hullPts: [], subparts: [], canUngroup: true,
    connections: [
      { type: a, x: -2, y: 0, angle: 180, electricPlug: 0 },
      { type: b, x: 2, y: 0, angle: 0, electricPlug: 0 },
    ],
  });
  const catalog: Catalog = new Map([
    ['straight', part('straight', '1', '1')],
    ['flex', part('flex', 'flexpivot', 'flexpivot')],
  ]);
  const brick = (id: string, partNumber: string, x: number): Brick => ({
    id, partNumber, myGroup: '', orientation: 0, activeConnectionPointIndex: 1, altitude: 0,
    displayArea: { x: x - 2, y: -1, width: 4, height: 2 },
    connexions: [{ id: `${id}_0`, linkedTo: '' }, { id: `${id}_1`, linkedTo: '' }],
  });
  function chain(): LayerBrick {
    const bricks = [brick('s', 'straight', 0), brick('f1', 'flex', 4), brick('f2', 'flex', 8), brick('f3', 'flex', 12)];
    const layer = { type: 'brick', id: 'L', name: 'L', visible: true, bricks, groups: [] } as unknown as LayerBrick;
    rebuildConnectivity({ layers: [layer] } as unknown as BbmMap, catalog);
    return layer;
  }

  it('bends the flex pieces towards the target, each joint within its 10° hinge', () => {
    const layer = chain();
    const all = new Set(layer.bricks.map((b) => b.id));
    const flex = FlexMove.start(layer, all, 'f3', { x: 14, y: 0 }, catalog)!;
    expect(flex).not.toBeNull();
    flex.moveTo({ x: 13, y: 3 }, 0, false);
    const [s, f1, f2, f3] = layer.bricks;
    // The rigid straight stays put; the flex end moved up towards y = 3 (down is +y).
    expect(s!.orientation).toBe(0);
    expect(centre(s!)).toEqual({ x: 0, y: 0 });
    expect(centre(f3!).y).toBeGreaterThan(0.5);
    // Relative turn at each flex joint is at most 10°.
    for (const [a, b] of [[s!, f1!], [f1!, f2!], [f2!, f3!]] as const) {
      const d = Math.abs((((b.orientation - a.orientation) % 360) + 540) % 360 - 180);
      expect(d).toBeLessThanOrEqual(10.001);
    }
    // The pieces stay joined: consecutive connection points still coincide.
    const end = (b: Brick, sign: number) => {
      const r = (b.orientation * Math.PI) / 180;
      return { x: centre(b).x + sign * 2 * Math.cos(r), y: centre(b).y + sign * 2 * Math.sin(r) };
    };
    for (const [a, b] of [[f1!, f2!], [f2!, f3!]] as const) {
      expect(Math.hypot(end(a, 1).x - end(b, -1).x, end(a, 1).y - end(b, -1).y)).toBeLessThan(1e-3);
    }
  });

  it('reports the joints at their hinge limit (drawn amber while bending)', () => {
    const layer = chain();
    const flex = FlexMove.start(layer, new Set(layer.bricks.map((b) => b.id)), 'f3', { x: 14, y: 0 }, catalog)!;
    expect(flex.hingesAtLimit()).toEqual([]);
    // Far to the side: more than three 10° joints allow.
    flex.moveTo({ x: 4, y: 12 }, 0, false);
    const limits = flex.hingesAtLimit();
    expect(limits.length).toBeGreaterThan(0);
    // Each is at a joint: the end of one piece.
    for (const p of limits) {
      const near = layer.bricks.some((b) => {
        const r = (b.orientation * Math.PI) / 180;
        return [-1, 1].some((k) => Math.hypot(centre(b).x + k * 2 * Math.cos(r) - p.x, centre(b).y + k * 2 * Math.sin(r) - p.y) < 1e-3);
      });
      expect(near, `${p.x},${p.y}`).toBe(true);
    }
  });

  it('ends when links go round in a circle away from the grabbed piece (the desktop crash)', () => {
    // f2 and f3 joined at both ends to each other (one turned onto the
    // other), entered by a stale one-way link from f1: the chain from f1
    // went f2, f3, f2, f3... for ever. Hand-set links, as a corrupt layout
    // would have them.
    const layer = chain();
    const [, f1, f2, f3] = layer.bricks;
    for (const b of layer.bricks) for (const c of b.connexions) c.linkedTo = '';
    f1!.connexions[1]!.linkedTo = 'f2_0';
    f2!.connexions[0]!.linkedTo = 'f3_0';
    f3!.connexions[0]!.linkedTo = 'f2_0';
    f2!.connexions[1]!.linkedTo = 'f3_1';
    f3!.connexions[1]!.linkedTo = 'f2_1';
    const flex = FlexMove.start(layer, new Set(['f1', 'f2', 'f3']), 'f1', { x: 2, y: 0 }, catalog);
    if (flex) {
      expect(flex.currentState().length).toBeLessThanOrEqual(layer.bricks.length);
      flex.moveTo({ x: 3, y: 2 }, 0, false);
      flex.restore();
    }
  });

  it('a selection without a hinge is not flexible; restore undoes the bend', () => {
    const layer = chain();
    expect(FlexMove.start(layer, new Set(['s']), 's', { x: 0, y: 0 }, catalog)).toBeNull();
    const before = layer.bricks.map((b) => ({ ...b.displayArea, o: b.orientation }));
    const flex = FlexMove.start(layer, new Set(layer.bricks.map((b) => b.id)), 'f3', { x: 14, y: 0 }, catalog)!;
    flex.moveTo({ x: 12, y: 5 }, 0, false);
    expect(flex.currentState().length).toBeGreaterThan(0);
    flex.restore();
    expect(layer.bricks.map((b) => ({ ...b.displayArea, o: b.orientation }))).toEqual(before);
  });
});
