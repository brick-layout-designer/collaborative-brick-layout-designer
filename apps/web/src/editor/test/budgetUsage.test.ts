// Budget usage — part ids match case-insensitively (desktop Budget.cpp).

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import { budgetRows, limitFor, overBudgetCount } from '../budgetUsage';

function mapWith(parts: string[]): BbmMap {
  return {
    layers: [{ type: 'brick', id: 'L', name: 'Bricks', bricks: parts.map((partNumber, i) => ({ id: String(i), partNumber })) }],
  } as unknown as BbmMap;
}

describe('budget usage is case-insensitive', () => {
  const map = mapWith(['3001.1', '3001.1', 'ts_curve.8', 'TS_CURVE.8', '3710.1']);

  it('a limit entered in another case applies to the placed bricks', () => {
    const limits = new Map([['TS_CURVE.8', 1]]);
    expect(limitFor(limits, 'ts_curve.8')).toBe(1);
    const rows = budgetRows(map, limits);
    // One row, not one per spelling; shown with the limit's own spelling.
    expect(rows.filter((r) => r.part.toLowerCase() === 'ts_curve.8')).toEqual([
      { part: 'TS_CURVE.8', used: 2, limit: 1, limitKey: 'TS_CURVE.8' },
    ]);
    expect(overBudgetCount(map, limits)).toBe(1);
  });

  it('rows cover placed and limited parts; unlimited parts have no limit key', () => {
    const rows = budgetRows(map, new Map([['9999.1', 0]]));
    expect(rows.map((r) => [r.part, r.used, r.limit])).toEqual([
      ['3001.1', 2, undefined],
      ['3710.1', 1, undefined],
      ['9999.1', 0, 0],
      ['ts_curve.8', 2, undefined],
    ]);
  });

  it('nothing is over budget without limits', () => {
    expect(overBudgetCount(map, new Map())).toBe(0);
  });
});
