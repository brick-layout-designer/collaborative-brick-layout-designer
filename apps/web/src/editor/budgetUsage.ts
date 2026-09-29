// Budget usage against limits. Part ids are case-insensitive, like
// desktop Budget.cpp (it keys budgets by the upper-cased id). The limits
// keep the case they were entered or opened with, so a `.bbb` saves back
// unchanged; every lookup here folds case.

import type { BbmMap } from '@cld/model';

const fold = (part: string) => part.toLowerCase();

export interface BudgetRow {
  /** Part id as shown: the limit's own spelling, else the first placed brick's. */
  part: string;
  used: number;
  /** The limit, or undefined for no limit. */
  limit: number | undefined;
  /** Key of the limit in the limits map, when there is one. */
  limitKey: string | undefined;
}

/** Placed bricks per part, case folded: folded id → { first spelling, count }. */
export function countUsage(map: BbmMap | null | undefined): Map<string, { part: string; count: number }> {
  const usage = new Map<string, { part: string; count: number }>();
  if (!map) return usage;
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      const k = fold(b.partNumber);
      const u = usage.get(k);
      if (u) u.count++;
      else usage.set(k, { part: b.partNumber, count: 1 });
    }
  }
  return usage;
}

/** Folded id → [stored key, limit]. The first spelling wins if two differ only in case. */
function foldLimits(limits: ReadonlyMap<string, number>): Map<string, [string, number]> {
  const out = new Map<string, [string, number]>();
  for (const [key, limit] of limits) {
    const k = fold(key);
    if (!out.has(k)) out.set(k, [key, limit]);
  }
  return out;
}

/** The limit for `part`, matched case-insensitively. */
export function limitFor(limits: ReadonlyMap<string, number>, part: string): number | undefined {
  const direct = limits.get(part);
  if (direct !== undefined) return direct;
  return foldLimits(limits).get(fold(part))?.[1];
}

/** One row per part that is placed or has a limit, sorted by part id. */
export function budgetRows(map: BbmMap | null | undefined, limits: ReadonlyMap<string, number>): BudgetRow[] {
  const usage = countUsage(map);
  const folded = foldLimits(limits);
  const keys = new Set([...usage.keys(), ...folded.keys()]);
  return [...keys]
    .map((k) => {
      const lim = folded.get(k);
      return {
        part: lim?.[0] ?? usage.get(k)!.part,
        used: usage.get(k)?.count ?? 0,
        limit: lim?.[1],
        limitKey: lim?.[0],
      };
    })
    .sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
}

/** Number of parts placed more times than their limit allows. */
export function overBudgetCount(map: BbmMap | null | undefined, limits: ReadonlyMap<string, number>): number {
  if (limits.size === 0) return 0;
  return budgetRows(map, limits).filter((r) => r.limit !== undefined && r.used > r.limit).length;
}
