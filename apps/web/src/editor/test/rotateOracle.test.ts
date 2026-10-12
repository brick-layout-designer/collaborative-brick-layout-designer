// Rotate against vanilla BlueBrick's own (packages/bbm/tests/fixtures/oracle/
// rot-*.bbm, made with the desktop's scripts/bluebrick-oracle/bbrotate.cs
// from flex-in.bbm; desktop RotateOracleTest.cpp):
//   rot-all1 / rot-all2  every part, one step / two in a row: about the box centre
//   rot-45x1 / rot-45x2  the same by 45 degrees: the second turn is about the
//                        new box's centre (vanilla's sLastCenter is cleared)
//   rot-one-ccw / -cw    the straight alone, joined to the flex end: it steps
//                        round that join, so it flips in place
// Needs <repo>/parts-library; skipped without it.
import { beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import type { BbmMap, LayerBrick } from '@cld/model';
import { docToBbm, seedFromBbm } from '@cld/ydoc';
import type { PartGeom } from '../brickGeometry';
import { rotateSelection } from '../mutations';
import { connectedTurn } from '../rotateTurn';

// Node's fs and the catalog scan, loaded at run time (the app's types are
// the browser's).
type Fs = { existsSync(p: string): boolean; readFileSync(p: string, enc?: string): Uint8Array & string };
const fs = (await import('node:' + 'fs')) as Fs;
const at = (rel: string) => decodeURIComponent(new URL(rel, import.meta.url).pathname);
const PARTS = at('../../../../../parts-library/parts/');
const oracle = (name: string) => readBbm(fs.readFileSync(at(`../../../../../packages/bbm/tests/fixtures/oracle/${name}`), 'utf8')).map;
const bricksOf = (map: BbmMap) => map.layers.find((l): l is LayerBrick => l.type === 'brick')!.bricks;
const STRAIGHT = '186617953428535140';

describe.skipIf(!fs.existsSync(PARTS))('rotate matches vanilla BlueBrick', () => {
  const geom = new Map<string, PartGeom>();
  const partOf = (n: string) => geom.get(n.toLowerCase());
  beforeAll(async () => {
    const { scanCatalog } = (await import('@cld/parts-catalog' as string)) as {
      scanCatalog(root: string): Promise<{ catalog: Map<string, { partNumber: string; colorCode: string; spritePath: string; pxPerStud: number; hullPts: { x: number; y: number }[]; connections: unknown[] }> }>;
    };
    const { catalog } = await scanCatalog(PARTS);
    for (const b of bricksOf(oracle('flex-in.bbm'))) {
      const meta = [...catalog.values()].find((m) => `${m.partNumber}.${m.colorCode}`.toLowerCase() === b.partNumber.toLowerCase());
      if (!meta) continue;
      // The sprite's size from its GIF / PNG header.
      const img = fs.readFileSync(PARTS + meta.spritePath);
      const v = new DataView(img.buffer, img.byteOffset, img.byteLength);
      const gif = img[0] === 0x47;
      const size = gif ? { w: v.getUint16(6, true), h: v.getUint16(8, true) } : { w: v.getUint32(16), h: v.getUint32(20) };
      geom.set(b.partNumber.toLowerCase(), { pxPerStud: meta.pxPerStud, hullPts: meta.hullPts, spriteSize: size, connections: meta.connections as NonNullable<PartGeom['connections']> });
    }
  }, 60_000);

  function run(turns: { ids: string[] | 'all'; degrees: number }[]): BbmMap {
    const doc = seedFromBbm(oracle('flex-in.bbm'));
    const layerId = doc.getArray<string>('layers').toArray().find((id) => (doc.getMap('layerData').get(id) as Y.Map<unknown>).get('bricks'))!;
    for (const t of turns) {
      const ids = t.ids === 'all' ? bricksOf(docToBbm(doc)).map((b) => b.id) : t.ids;
      rotateSelection(doc, new Map([[layerId, ids]]), { texts: [], rulers: [] }, t.degrees, partOf);
    }
    return docToBbm(doc);
  }
  function expectLikeVanilla(got: BbmMap, expected: string) {
    const want = new Map(bricksOf(oracle(expected)).map((b) => [b.id, b]));
    for (const b of bricksOf(got)) {
      const v = want.get(b.id)!;
      const what = `${expected} ${b.id}`;
      const dOrient = ((((b.orientation - v.orientation) % 360) + 540) % 360) - 180;
      expect(Math.abs(dOrient), what).toBeLessThan(1e-3);
      expect(b.displayArea.x, what).toBeCloseTo(v.displayArea.x, 2);
      expect(b.displayArea.y, what).toBeCloseTo(v.displayArea.y, 2);
      expect(b.displayArea.width, what).toBeCloseTo(v.displayArea.width, 2);
      expect(b.displayArea.height, what).toBeCloseTo(v.displayArea.height, 2);
    }
  }

  it('several parts turn about their box centre', () => expectLikeVanilla(run([{ ids: 'all', degrees: 90 }]), 'rot-all1.bbm'));
  it('turning again turns about the new box', () =>
    expectLikeVanilla(run([{ ids: 'all', degrees: 90 }, { ids: 'all', degrees: 90 }]), 'rot-all2.bbm'));
  it('a 45-degree step turns about the box centre', () => expectLikeVanilla(run([{ ids: 'all', degrees: 45 }]), 'rot-45x1.bbm'));
  it('a 45-degree step twice turns about the new box the second time', () =>
    expectLikeVanilla(run([{ ids: 'all', degrees: 45 }, { ids: 'all', degrees: 45 }]), 'rot-45x2.bbm'));
  it('a joined part steps round its join', () => expectLikeVanilla(run([{ ids: [STRAIGHT], degrees: 90 }]), 'rot-one-ccw.bbm'));
  it('and back round it', () => expectLikeVanilla(run([{ ids: [STRAIGHT], degrees: -90 }]), 'rot-one-cw.bbm'));

  it('connectedTurn: nothing joined outside is a plain turn', () => {
    const all = bricksOf(oracle('flex-in.bbm')).map((b) => ({ ...b, part: partOf(b.partNumber) }));
    expect(connectedTurn(all, all, 1)).toBeNull();
    const turn = connectedTurn([all[0]!], all, 1)!;
    expect(Math.abs(((turn.degrees % 360) + 360) % 360)).toBeCloseTo(180, 6);
    expect(turn.brickId).toBe(STRAIGHT);
    expect(turn.connection).toBe(0);
  });
});
