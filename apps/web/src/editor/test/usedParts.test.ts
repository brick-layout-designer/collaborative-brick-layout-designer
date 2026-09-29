// Used Parts filter and summary (PartUsagePanel.cpp refresh).

import { describe, expect, it } from 'vitest';
import { filterUsedParts, overBy, usedPartsSummary } from '../usedParts';

const rows = [
  { partNumber: '3857.0', count: 72, description: 'Baseplate 32 x 32' },
  { partNumber: '2865.8', count: 10, description: 'Train track straight' },
  { partNumber: 'TABLE96X190', count: 1, description: 'Table' },
];
// Case-insensitive part ids, like the budget.
const limits = new Map([['3857.0', 70], ['2865.8', 10]]);

describe('Used Parts', () => {
  it('"over" keeps only parts past their budget', () => {
    expect(overBy(rows[0]!, limits)).toBe(2);
    expect(overBy(rows[1]!, limits)).toBe(0);
    expect(overBy(rows[2]!, limits)).toBe(0);
    expect(filterUsedParts(rows, ' OVER ', limits).map((r) => r.partNumber)).toEqual(['3857.0']);
    expect(filterUsedParts(rows, 'over', new Map())).toEqual([]);
  });

  it('otherwise matches part number or description, ignoring case', () => {
    expect(filterUsedParts(rows, 'track', limits).map((r) => r.partNumber)).toEqual(['2865.8']);
    expect(filterUsedParts(rows, 'table96', limits).map((r) => r.partNumber)).toEqual(['TABLE96X190']);
    expect(filterUsedParts(rows, '', limits)).toHaveLength(3);
  });

  it('summarises every part, naming the over-budget kinds', () => {
    expect(usedPartsSummary(rows, limits)).toBe('3 distinct part(s), 83 brick(s) total — 1 kind(s) over budget');
    expect(usedPartsSummary(rows, new Map())).toBe('3 distinct part(s), 83 brick(s) total');
  });
});
