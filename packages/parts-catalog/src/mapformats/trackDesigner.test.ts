// TrackDesigner .tdl against vanilla BlueBrick (desktop LDrawMapTest.cpp):
// tight-corner.tdl is what vanilla wrote for tight-corner.bbm, and
// tight-corner.from-tdl.bbm what it read back from it.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBbm, writeBbm } from '@cld/bbm';
import { rebuildConnectivity } from '../connectivity.js';
import { scanCatalog } from '../scan.js';
import { MapLibrary, newBrickLayer, newMap } from './library.js';
import { bricksOf, oracleMap, ORACLE, PARTS, ROOT, unmatched } from './oracleUtil.js';
import { parsePartXml } from '../parse.js';
import { partForTrackDesignerId, readTrackDesignerMap, writeTrackDesignerMap } from './trackDesigner.js';

const corpus = (name: string) => readBbm(readFileSync(resolve(ROOT, 'packages/bbm/tests/fixtures', name), 'utf8')).map;

/**
 * Pieces of a TrackDesigner file, with instance ids replaced by piece
 * indices (BlueBrick writes object hash codes) and polarity dropped.
 */
function tdlPieces(d: Uint8Array): string[] {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let pos = 0;
  const i32 = () => ((pos += 4), v.getInt32(pos - 4, true));
  const i16 = () => ((pos += 2), v.getInt16(pos - 2, true));
  const f64 = () => ((pos += 8), v.getFloat64(pos - 8, true));
  const str = () => {
    const n = d[pos++]!; // ASCII in these fixtures
    pos += n;
  };
  pos = 4 * 4 + 4 * 4 + 4 * 8 + 4 * 4;
  str();
  pos += 5 * 4;
  str();
  str();
  const pieceList = i16();
  pos += pieceList > 0 ? 12 + pieceList * 40 : 0;
  if (i16() <= 0) return [];
  pos += 17;
  const pieces: { id: number; inst: number; nums: number[]; type: number; port: number; conn: number[][]; flags: number }[] = [];
  while (pos < d.length) {
    const id = i32();
    const inst = i32();
    const nums = [f64(), f64(), f64(), f64()];
    const type = i32();
    const port = i32();
    const conn: number[][] = [];
    for (let i = 0; i < 4; i++) {
      conn.push([i32(), i32()]);
      i32();
    }
    const flags = i32();
    i32();
    pieces.push({ id, inst, nums, type, port, conn, flags });
    if (pos < d.length) pos += 2;
  }
  const index = new Map(pieces.map((p, i) => [p.inst, i]));
  return pieces.map((p) => {
    const c = p.conn.map(([inst, port]) => {
      const other = inst ? (index.get(inst!) ?? -1) : -1;
      return other >= 0 ? `${other}:${port}` : '-';
    });
    return [p.id, ...p.nums.map((n) => n.toFixed(3)), p.type, p.port, ...c, `f${p.flags}`].join(' ');
  });
}

describe.skipIf(!existsSync(PARTS))('TrackDesigner maps match vanilla BlueBrick', () => {
  let lib: MapLibrary;
  beforeAll(async () => {
    lib = new MapLibrary((await scanCatalog(PARTS)).catalog);
  }, 60_000);

  it('writes what vanilla wrote', () => {
    const map = corpus('tight-corner.bbm');
    rebuildConnectivity(map, lib.catalog);
    const ours = tdlPieces(writeTrackDesignerMap(map, lib));
    const vanilla = tdlPieces(readFileSync(resolve(ORACLE, 'tight-corner.tdl')));
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).toEqual(vanilla);
  });

  it('reads what vanilla read', () => {
    const vanilla = oracleMap('tight-corner.from-tdl.bbm');
    const ours = readTrackDesignerMap(readFileSync(resolve(ORACLE, 'tight-corner.tdl')), lib);
    expect(unmatched(bricksOf(ours.map), bricksOf(vanilla))).toBe('');
    expect(ours.map.layers.map((l) => l.name)).toEqual(vanilla.layers.map((l) => l.name));
  });

  it('keeps the event and comment, and reports unmapped ids', () => {
    const map = newMap();
    map.event = 'Show';
    map.comment = 'Notes';
    const b = lib.newBrick(lib.meta('2865.8')!);
    lib.placeByImageCentre(b, { x: 10, y: 20 });
    map.layers.push(newBrickLayer('Track', [b]));
    const bytes = writeTrackDesignerMap(map, lib);
    const back = readTrackDesignerMap(bytes, lib);
    expect(back.map.event).toBe('Show');
    expect(back.map.comment).toBe('Notes');
    expect(unmatched(bricksOf(back.map), bricksOf(map), false)).toBe('');

    // Rewrite the piece's TD id to one no part has.
    const pieces = bytes.length - (4 + 4 + 8 * 4 + 4 + 4 + 4 * 12 + 4 + 4);
    new DataView(bytes.buffer).setInt32(pieces, 999999, true);
    const bad = readTrackDesignerMap(bytes, lib);
    expect(bad.warnings).toEqual(['No part is mapped to these TrackDesigner ids: 999999']);
    expect(bad.map.layers).toEqual([]);
  });

  it('rejects other file versions and truncated files', () => {
    const bytes = writeTrackDesignerMap(newMap(), lib);
    expect(() => readTrackDesignerMap(bytes.slice(0, 40), lib)).toThrow('Truncated');
    new DataView(bytes.buffer).setInt32(12, 19, true);
    expect(() => readTrackDesignerMap(bytes, lib)).toThrow('version 20');
  });

  it('reads NaN and infinite numbers as 0, so the map can be saved', () => {
    const map = newMap();
    const b = lib.newBrick(lib.meta('2865.8')!);
    lib.placeByImageCentre(b, { x: 10, y: 20 });
    map.layers.push(newBrickLayer('Track', [b]));
    const bytes = writeTrackDesignerMap(map, lib);
    // The piece's angle and x: after id, instance (4 + 4 bytes) of the only piece.
    const piece = bytes.length - (4 + 4 + 8 * 4 + 4 + 4 + 4 * 12 + 4 + 4);
    const v = new DataView(bytes.buffer);
    v.setFloat64(piece + 8, Number.NaN, true);
    v.setFloat64(piece + 16, Number.POSITIVE_INFINITY, true);
    const r = readTrackDesignerMap(bytes, lib);
    expect(() => writeBbm(r.map)).not.toThrow();
    const l = r.map.layers[0]!;
    if (l.type !== 'brick') throw new Error('brick layer');
    expect(l.bricks[0]!.orientation).toBe(0);
  });
});

describe('partForTrackDesignerId', () => {
  const part = (key: string, td: string) => {
    const [partNumber, colorCode] = key.split('.') as [string, string];
    return parsePartXml(`<part><TrackDesigner>${td}</TrackDesigner></part>`, { partNumber, colorCode, spritePath: '' });
  };
  const lib = (...parts: ReturnType<typeof part>[]) => new MapLibrary(new Map(parts.map((p) => [p.key, p])));

  it('prefers a default id, then the last part by key', () => {
    const a = part('3867.25', '<ID>5</ID>');
    const b = part('3867.7', '<ID>5</ID>');
    const c = part('9999.1', '<IDList><ID>7</ID><ID registry="lug">5</ID></IDList>');
    // Keys sort as "3867.25" < "3867.7" < "9999.1".
    expect(partForTrackDesignerId(lib(b, c, a), 5)?.key).toBe('3867.7');
    expect(partForTrackDesignerId(lib(c), 5)?.key).toBe('9999.1');
    expect(partForTrackDesignerId(lib(a, b), 6)).toBeUndefined();
  });
});
