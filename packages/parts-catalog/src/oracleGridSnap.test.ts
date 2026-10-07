// The parts the grid-snap cases use (apps/web/src/editor/test/fixtures/
// grid-snap-vectors.json, from vanilla BlueBrick under Wine) read the same
// <SnapMargin> here, and their display areas are the size vanilla gave
// them. Needs <repo>/parts-library, like scan.test.ts; skipped without it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { footprint } from './footprint.js';
import { scanCatalog } from './scan.js';
import type { Catalog } from './types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PARTS = resolve(ROOT, 'parts-library/parts');
interface Vectors {
  offsets: { part: string; margin: number[]; orientation: number }[];
  drags: { part: string; orientation: number; area: number[] }[];
}
const VEC = JSON.parse(
  readFileSync(resolve(ROOT, 'apps/web/src/editor/test/fixtures/grid-snap-vectors.json'), 'utf8'),
) as Vectors;
// Made for the oracle only, not in the library.
const LIBRARY = (part: string) => part !== 'IMPORTTEST.1';

describe.skipIf(!existsSync(PARTS))('grid snap parts match vanilla BlueBrick', () => {
  let catalog: Catalog;
  beforeAll(async () => {
    catalog = (await scanCatalog(PARTS)).catalog;
  }, 60_000);

  it('reads their <SnapMargin>', () => {
    for (const c of VEC.offsets.filter((o) => LIBRARY(o.part))) {
      const meta = catalog.get(c.part.toLowerCase());
      expect(meta, c.part).toBeTruthy();
      const [left, right, top, bottom] = c.margin;
      const want = left || right || top || bottom ? { left, right, top, bottom } : undefined;
      expect(meta?.snapMargin, c.part).toEqual(want);
    }
  });

  it('sizes their display areas as vanilla does', () => {
    for (const c of VEC.drags.filter((d) => LIBRARY(d.part))) {
      const meta = catalog.get(c.part.toLowerCase());
      const fp = meta ? footprint(meta, c.orientation) : null;
      expect(fp, JSON.stringify(c)).toBeTruthy();
      expect(fp!.size.w, JSON.stringify(c)).toBeCloseTo(c.area[2]!, 3);
      expect(fp!.size.h, JSON.stringify(c)).toBeCloseTo(c.area[3]!, 3);
    }
  });
});
