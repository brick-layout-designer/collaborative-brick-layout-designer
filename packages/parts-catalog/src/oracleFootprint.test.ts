// Footprint and pivot against vanilla BlueBrick: every brick in maps it
// saved has exactly the displayArea size footprint() computes, and every
// pair of connections it linked coincides when measured from the sprite
// centre (displayArea centre + imageOffset). Needs <repo>/parts-library,
// like scan.test.ts; skipped without it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import { footprint, imageOffset } from './footprint.js';
import { scanCatalog } from './scan.js';
import type { Catalog } from './types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PARTS = resolve(ROOT, 'parts-library/parts');
const FIXTURES = resolve(ROOT, 'packages/bbm/tests/fixtures');
const MAPS = [
  'tight-corner.bbm',
  'fordyce-2026.bbm',
  'oracle/flex-a.bbm',
  'oracle/flex-b.bbm',
  'oracle/flex-c.bbm',
  'oracle/flex-in.bbm',
  'oracle/fourdbrix.bbm',
  'oracle/fourdbrix.from-ncp.bbm',
  'oracle/tight-corner.from-ldr.bbm',
  'oracle/tight-corner.from-mpd.bbm',
  'oracle/tight-corner.from-tdl.bbm',
];

describe.skipIf(!existsSync(PARTS))('footprint and pivot match vanilla BlueBrick', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    catalog = (await scanCatalog(PARTS)).catalog;
  }, 60_000);

  for (const file of MAPS) {
    it(`${file}: displayArea sizes`, () => {
      const map = readBbm(readFileSync(resolve(FIXTURES, file), 'utf8')).map;
      const wrong: string[] = [];
      let checked = 0;
      for (const l of map.layers) {
        if (l.type !== 'brick') continue;
        for (const b of l.bricks) {
          const meta = catalog.get(b.partNumber.toLowerCase());
          const fp = meta ? footprint(meta, b.orientation) : null;
          if (!fp) continue;
          checked++;
          if (Math.abs(fp.size.w - b.displayArea.width) > 0.01 || Math.abs(fp.size.h - b.displayArea.height) > 0.01) {
            wrong.push(`${b.partNumber}@${b.orientation}`);
          }
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(wrong).toEqual([]);
    });

    it(`${file}: linked connections meet at the sprite-centre pivot`, () => {
      const map = readBbm(readFileSync(resolve(FIXTURES, file), 'utf8')).map;
      const pos = new Map<string, { x: number; y: number }>();
      const pairs: [string, string][] = [];
      for (const l of map.layers) {
        if (l.type !== 'brick') continue;
        for (const b of l.bricks) {
          const meta = catalog.get(b.partNumber.toLowerCase());
          if (!meta) continue;
          const off = imageOffset(meta, b.orientation);
          const cx = b.displayArea.x + b.displayArea.width / 2 + off.x;
          const cy = b.displayArea.y + b.displayArea.height / 2 + off.y;
          const r = (b.orientation * Math.PI) / 180;
          b.connexions.forEach((c, i) => {
            const cp = meta.connections[i];
            if (!cp) return;
            pos.set(c.id, { x: cx + cp.x * Math.cos(r) - cp.y * Math.sin(r), y: cy + cp.x * Math.sin(r) + cp.y * Math.cos(r) });
            if (c.linkedTo && c.id < c.linkedTo) pairs.push([c.id, c.linkedTo]);
          });
        }
      }
      for (const [a, b] of pairs) {
        const p = pos.get(a);
        const q = pos.get(b);
        if (!p || !q) continue;
        expect(Math.hypot(p.x - q.x, p.y - q.y), `${a} ↔ ${b}`).toBeLessThan(0.01);
      }
    });
  }
});
