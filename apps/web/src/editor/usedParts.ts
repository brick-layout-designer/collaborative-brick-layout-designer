// Used Parts filter and summary — PartUsagePanel.cpp refresh(): the filter
// matches part # or description, and the word "over" instead shows only
// parts placed more times than their budget allows.

import { limitFor } from './budgetUsage';

export interface UsedPartRow {
  partNumber: string;
  count: number;
  description: string;
}

/** How many past its budget a row is; 0 without a limit. */
export function overBy(row: UsedPartRow, limits: ReadonlyMap<string, number>): number {
  const limit = limitFor(limits, row.partNumber);
  return limit === undefined ? 0 : Math.max(0, row.count - limit);
}

export function filterUsedParts(rows: readonly UsedPartRow[], filter: string, limits: ReadonlyMap<string, number>): UsedPartRow[] {
  const q = filter.trim().toLowerCase();
  if (q === 'over') return rows.filter((r) => overBy(r, limits) > 0);
  if (!q) return [...rows];
  return rows.filter((r) => `${r.partNumber} ${r.description}`.toLowerCase().includes(q));
}

/** "N distinct part(s), M brick(s) total[ — K kind(s) over budget]" over every row, filter or not. */
export function usedPartsSummary(rows: readonly UsedPartRow[], limits: ReadonlyMap<string, number>): string {
  const total = rows.reduce((n, r) => n + r.count, 0);
  const over = rows.filter((r) => overBy(r, limits) > 0).length;
  const base = `${rows.length} distinct part(s), ${total} brick(s) total`;
  return over > 0 ? `${base} — ${over} kind(s) over budget` : base;
}
