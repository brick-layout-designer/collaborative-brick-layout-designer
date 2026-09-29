// Fuzzing the map-format readers (the desktop's rule: every parser gets a
// fuzz harness): mutated and truncated copies of vanilla's own files must
// read or fail with an Error — never hang or crash — and what they read
// must save as a .bbm (no NaN or infinite numbers).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { writeBbm } from '@cld/bbm';
import { scanCatalog } from '../scan.js';
import { readFourDBrixMap } from './fourDBrix.js';
import { readLDrawMap } from './ldraw.js';
import { MapLibrary, type MapReadResult } from './library.js';
import { ORACLE, PARTS } from './oracleUtil.js';
import { readTrackDesignerMap } from './trackDesigner.js';

/** A small deterministic PRNG, so a failure can be replayed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INTERESTING = [0x00, 0xff, 0x7f, 0x80, 0x20, 0x22, 0x2e, 0x2d, 0x30, 0x39, 0x3c, 0x3e, 0x0a, 0x7c, 0x23];

function mutate(data: Uint8Array, rand: () => number): Uint8Array {
  let out = data.slice();
  const edits = 1 + Math.floor(rand() * 8);
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(rand() * out.length);
    const kind = rand();
    if (kind < 0.5) out[at] = INTERESTING[Math.floor(rand() * INTERESTING.length)]!;
    else if (kind < 0.7) out[at] = Math.floor(rand() * 256);
    else if (kind < 0.85) out = out.slice(0, at); // truncate
    else {
      // duplicate a chunk
      const len = Math.floor(rand() * 64);
      const chunk = out.slice(at, at + len);
      const next = new Uint8Array(out.length + chunk.length);
      next.set(out.slice(0, at));
      next.set(chunk, at);
      next.set(out.slice(at), at + chunk.length);
      out = next;
    }
    if (out.length === 0) break;
  }
  return out;
}


describe.skipIf(!existsSync(PARTS))('map-format readers survive mutated input', () => {
  let lib: MapLibrary;
  beforeAll(async () => {
    lib = new MapLibrary((await scanCatalog(PARTS)).catalog);
  }, 60_000);

  const dec = new TextDecoder();
  const cases: [string, (d: Uint8Array) => MapReadResult][] = [
    ['tight-corner.ldr', (d) => readLDrawMap(dec.decode(d), lib, { mpd: false })],
    ['sleepers.mpd', (d) => readLDrawMap(dec.decode(d), lib, { mpd: true })],
    ['tight-corner.tdl', (d) => readTrackDesignerMap(d, lib)],
    ['fourdbrix.ncp', (d) => readFourDBrixMap(dec.decode(d), lib)],
  ];
  for (const [file, read] of cases) {
    it(file, () => {
      const data = new Uint8Array(readFileSync(resolve(ORACLE, file)));
      const rand = rng(0xb10c + file.length);
      for (let i = 0; i < 150; i++) {
        const input = mutate(data, rand);
        let result: MapReadResult | undefined;
        try {
          result = read(input);
        } catch (err) {
          expect(err, `mutation ${i}`).toBeInstanceOf(Error);
          continue;
        }
        expect(() => writeBbm(result.map), `mutation ${i}`).not.toThrow();
      }
    }, 60_000);
  }
});
