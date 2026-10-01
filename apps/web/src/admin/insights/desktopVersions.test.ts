// The dashboard's desktop-version marks, against compat/compat.json (the
// cases the server and the desktop app test too).

import compatJson from '../../../../../compat/compat.json';
import { describe, expect, it } from 'vitest';
import { compareVersions, desktopStanding, desktopVersionBars } from './desktopVersions';

const compat = compatJson as {
  cases: {
    versionCompare: { a: string; b: string; cmp: number | null }[];
    standing: { app: string; minimum: string; recommended: string; expect: string }[];
  };
};

describe('desktop versions on the dashboard', () => {
  it.each(compat.cases.versionCompare)('compares $a with $b', ({ a, b, cmp }) => {
    expect(compareVersions(a, b)).toBe(cmp);
  });

  it.each(compat.cases.standing)('$app against $minimum / $recommended is $expect', (c) => {
    expect(desktopStanding(c.app, c.minimum, c.recommended)).toBe(c.expect);
  });

  it('marks the versions that must or should update', () => {
    const bars = desktopVersionBars(
      [
        { key: '1.4.0', value: 5 },
        { key: '1.2.0', value: 3 },
        { key: '1.1.0', value: 1 },
      ],
      { minimum: '1.2.0', recommended: '1.3.0' },
    );
    expect(bars).toEqual([
      { label: 'Version 1.4.0', value: 5 },
      { label: 'Version 1.2.0', value: 3, detail: 'should update' },
      { label: 'Version 1.1.0', value: 1, detail: 'too old, must update' },
    ]);
    // A server from before the policy: nothing marked.
    expect(desktopVersionBars([{ key: '1.1.0', value: 1 }], undefined)).toEqual([{ label: 'Version 1.1.0', value: 1 }]);
  });
});
