// Part list CSV stays byte-identical to BlueBrick's for real layouts: every
// .bbm fixture's export is pinned to a golden file made before the formula
// defusing landed. Regenerate (only for a deliberate format change) with
// UPDATE_GOLDEN=1.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import type { PartWire } from '../../api';
import { parseBbb } from '../budgetFile';
import { buildPartList, partListCsv } from '../partList';
import BUDGET from '../../../../../packages/bbm/tests/fixtures/oracle/budget.bbb?raw';

const maps = import.meta.glob('../../../../../packages/bbm/tests/fixtures/**/*.bbm', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const goldens = import.meta.glob('./fixtures/partlist-csv/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const limits = new Map(parseBbb(BUDGET).map((e) => [e.part.toUpperCase(), e.limit]));

/** Descriptions as the parts library words them: some with commas. */
function descriptions(ids: Iterable<string>): Map<string, PartWire> {
  const out = new Map<string, PartWire>();
  let i = 0;
  for (const id of ids) out.set(id.toLowerCase(), { description: i++ % 3 === 0 ? `Brick ${id}, Track 9V` : `Plate ${id}` } as PartWire);
  return out;
}

describe('part list CSV golden files (BlueBrick fixtures)', () => {
  const names = Object.keys(maps).sort();
  it('covers the fixtures', () => expect(names.length).toBeGreaterThan(10));
  for (const path of names) {
    const name = path.split('/fixtures/')[1]!.replaceAll('/', '_');
    it(name, () => {
      const map = readBbm(maps[path]!).map;
      const ids = buildPartList(map, new Map())[0]!.rows.map((r) => r.partNumber);
      const parts = descriptions(ids);
      const csv = [
        partListCsv(buildPartList(map, parts), false),
        partListCsv(buildPartList(map, parts, { limits }), true),
        partListCsv(buildPartList(map, parts, { limits, splitPerLayer: true, defaultBudgetIsInfinite: false }), true),
      ].join('----\n');
      const file = `./fixtures/partlist-csv/${name}.csv`;
      if (process.env.UPDATE_GOLDEN) writeFileSync(fileURLToPath(new URL(file, import.meta.url)), csv);
      else expect(csv).toBe(goldens[file]);
    });
  }
});
