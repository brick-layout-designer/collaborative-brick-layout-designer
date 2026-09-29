// Three-way compare for the desktop reconnect window (sync P1b).

import { describe, expect, it } from 'vitest';
import type { BbmMap, Brick, LayerBrick, LayerRuler, RulerItem } from '@cld/model';
import type { Sidecar } from '@cld/bbm';
import { compareLayouts, type LayoutSnapshot } from './compare.js';

const brick = (id: string, x: number): Brick => ({
  id,
  displayArea: { x, y: 0, width: 2, height: 2 },
  myGroup: '',
  partNumber: '3001.1',
  orientation: 0,
  activeConnectionPointIndex: 0,
  altitude: 0,
  connexions: [{ id: `${id}c`, linkedTo: '' }],
});

const HULL = { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 } as const;
const ruler = (x: number): RulerItem => ({
  kind: 'linear', id: `r${Math.random()}`, displayArea: { x, y: 0, width: 10, height: 0 }, myGroup: '',
  color: { kind: 'known', name: 'Black' }, lineThickness: 1, displayDistance: true, displayUnit: true,
  guidelineColor: { kind: 'known', name: 'Black' }, guidelineThickness: 1, guidelineDashPattern: [], unit: 0,
  measureFont: { family: 'Arial', size: 8, style: 'Regular' }, measureFontColor: { kind: 'known', name: 'Black' },
  point1: { x, y: 0 }, point2: { x: x + 10, y: 0 }, attachedBrick1Id: '', attachedBrick2Id: '', offsetDistance: 0, allowOffset: false,
});

function snapshot(bricks: Brick[], opts: { rulers?: RulerItem[]; labelText?: string; event?: string } = {}): LayoutSnapshot {
  const layer: LayerBrick = { type: 'brick', id: 'L1', name: 'Track', visible: true, transparency: 100, hullProperties: { ...HULL }, displayBrickElevation: false, bricks, groups: [] };
  const rulers: LayerRuler = { type: 'ruler', id: 'L2', name: 'Rulers', visible: true, transparency: 100, hullProperties: { ...HULL }, rulerItems: opts.rulers ?? [], groups: [] };
  const map = {
    version: 9, nbItems: 0, backgroundColor: { kind: 'known', name: 'White' }, author: '', lug: '', event: opts.event ?? 'Show',
    date: { day: 1, month: 1, year: 2026 }, comment: '',
    exportInfo: { exportPath: '', exportFileType: 1, exportArea: { x: 0, y: 0, width: 0, height: 0 }, exportScale: 0, exportWatermark: false, exportElectricCircuit: false, exportConnectionPoints: false },
    selectedLayerIndex: 0, layers: [layer, rulers],
  } as BbmMap;
  const sidecar = opts.labelText === undefined ? null : ({
    schemaVersion: 1, bbmHashSha256: '',
    anchoredLabels: [{ id: 'lab1', text: opts.labelText }],
  } as unknown as Sidecar);
  return { map, sidecar };
}

const clone = <T>(v: T): T => structuredClone(v);

describe('compareLayouts', () => {
  it('sorts changes into mine, server, same and conflict', () => {
    const base = snapshot([brick('a', 0), brick('b', 10), brick('c', 20), brick('d', 30), brick('f', 50)]);
    const mine = snapshot([brick('a', 1), brick('b', 10), brick('c', 21), brick('e', 40), brick('f', 51)]);
    const server = snapshot([brick('a', 0), brick('b', 11), brick('c', 22), brick('e', 40)]);
    const byKey = Object.fromEntries(compareLayouts(base, mine, server).map((c) => [c.key, [c.status, c.mine, c.server]]));
    expect(byKey).toEqual({
      'brick:L1:a': ['mine', 'edited', 'unchanged'],
      'brick:L1:b': ['server', 'unchanged', 'edited'],
      'brick:L1:c': ['conflict', 'edited', 'edited'],
      // Both deleted it: agreed.
      'brick:L1:d': ['same', 'deleted', 'deleted'],
      // Both added the same brick.
      'brick:L1:e': ['same', 'added', 'added'],
      // Edited here, deleted there.
      'brick:L1:f': ['conflict', 'edited', 'deleted'],
    });
  });

  it("carries each side's value for the preview, and ignores unchanged items and link changes", () => {
    const base = snapshot([brick('a', 0), brick('b', 10)]);
    const mine = clone(base);
    const server = clone(base);
    // Only a connection link differs: derived from positions, not a change.
    (server.map.layers[0] as LayerBrick).bricks[1]!.connexions[0]!.linkedTo = 'xc';
    (mine.map.layers[0] as LayerBrick).bricks[0]!.displayArea.x = 5;
    const [change, ...rest] = compareLayouts(base, mine, server);
    expect(rest).toEqual([]);
    expect(change).toMatchObject({ key: 'brick:L1:a', kind: 'brick', layerId: 'L1', status: 'mine' });
    expect((change!.base as Brick).displayArea.x).toBe(0);
    expect((change!.mineValue as Brick).displayArea.x).toBe(5);
    expect((change!.serverValue as Brick).displayArea.x).toBe(0);
  });

  it('compares the header, layer properties, sidecar labels, and rulers by content', () => {
    const base = snapshot([], { rulers: [ruler(0)], labelText: 'Hi', event: 'Show' });
    const mine = snapshot([], { rulers: [ruler(5)], labelText: 'Hello', event: 'Show' });
    const server = snapshot([], { rulers: [ruler(0)], labelText: 'Hey', event: 'Expo' });
    (server.map.layers[0] as LayerBrick).name = 'Tracks';
    const changes = compareLayouts(base, mine, server);
    const summary = changes.map((c) => `${c.kind}:${c.status}:${c.mine}/${c.server}`).sort();
    expect(summary).toEqual([
      'label:conflict:edited/edited',
      'layer:server:unchanged/edited',
      'map:server:unchanged/edited',
      // The moved ruler is a delete of the old one and an add of the new one.
      'ruler:mine:added/unchanged',
      'ruler:mine:deleted/unchanged',
    ]);
  });

  it('reports nothing when all three agree', () => {
    const base = snapshot([brick('a', 0)], { labelText: 'x' });
    expect(compareLayouts(base, clone(base), clone(base))).toEqual([]);
  });
});
