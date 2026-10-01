// Which desktop versions must or should update, for the dashboard. Same
// rules as the server's compat.ts; compat/compat.json holds the cases
// both test against.

import type { KeyValue } from './insightsApi';
import type { BarItem } from './charts';

function parse(v: string): { nums: number[]; pre: string } | null {
  const m = /^[vV]?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(v.trim());
  return m ? { nums: m[1]!.split('.').map(Number), pre: m[2] ?? '' } : null;
}

/** -1, 0 or 1; null when either version can't be read. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (!pa.pre !== !pb.pre) return pa.pre ? -1 : 1;
  return 0;
}

export type Standing = 'ok' | 'updateSuggested' | 'updateRequired';

export function desktopStanding(app: string, minimum: string, recommended: string): Standing {
  if (minimum && compareVersions(app, minimum) === -1) return 'updateRequired';
  if (recommended && compareVersions(app, recommended) === -1) return 'updateSuggested';
  return 'ok';
}

export interface DesktopPolicy {
  minimum: string;
  recommended: string;
}

/** The chart's bars: "Version 1.2.0 · should update". */
export function desktopVersionBars(rows: KeyValue[], policy: DesktopPolicy | undefined): BarItem[] {
  return rows.map((r) => {
    const standing = policy ? desktopStanding(r.key, policy.minimum, policy.recommended) : 'ok';
    return {
      label: `Version ${r.key}`,
      value: r.value,
      ...(standing === 'updateRequired'
        ? { detail: 'too old, must update' }
        : standing === 'updateSuggested'
          ? { detail: 'should update' }
          : {}),
    };
  });
}
