// A set's version (setVersion.ts): the same text and digest the desktop's
// parts::setVersion makes (its SetVersionTest has these vectors), changing
// with the set's parts, where they sit, or its name, and with nothing else.

import { describe, expect, it } from 'vitest';
import { nestedSetVersion, setVersion, setVersionText, withNestedSetVersions } from './setVersion.js';

const subparts = [
  { subKey: 'Shed', x: 0, y: -11.5, angle: 0 },
  { subKey: 'lamp.1', x: 8.0004, y: 0.25, angle: -90 },
];

describe('a set’s version', () => {
  it('is made from its name and its parts, in order, to a thousandth of a stud', () => {
    expect(setVersionText({ name: ' Yard ', subparts })).toBe('set-v1\nYard\nshed|0|-11500|0\nlamp.1|8000|250|-90000\n');
    // Shared with the desktop (tests/parts/SetVersionTest.cpp).
    expect(setVersion({ name: 'Yard', subparts })).toBe('1572ba9befec980c');
  });

  it('changes with a part, a place, or the name, and not with a part number’s case', () => {
    const v = setVersion({ name: 'Yard', subparts });
    expect(setVersion({ name: 'Yard', subparts: subparts.map((s) => ({ ...s, subKey: s.subKey.toUpperCase() })) })).toBe(v);
    expect(setVersion({ name: 'Yard', subparts: [subparts[0]!] })).not.toBe(v);
    expect(setVersion({ name: 'Yard', subparts: [subparts[0]!, { ...subparts[1]!, x: 9 }] })).not.toBe(v);
    expect(setVersion({ name: 'Yard sidings', subparts })).not.toBe(v);
  });
});

// A custom set inside a set: Yard holds the custom set Shed. Shared with
// the desktop (tests/parts/SetVersionTest.cpp, NestedIsTheWebsForTheSameSets).
const shedParts = [
  { subKey: 'wall.1', x: 0, y: 0, angle: 0 },
  { subKey: 'door.1', x: 2, y: 0, angle: 90 },
];

describe('a set holding custom sets', () => {
  it('follows their versions, and keeps its own without any', () => {
    const shed = setVersion({ name: 'Shed', subparts: shedParts });
    expect(shed).toBe('e37a455ec528f2a9');
    expect(nestedSetVersion('1572ba9befec980c', [{ subKey: 'Shed', version: shed }])).toBe('b24401c61c9daf89');
    // The inner set loses its door: the outer one changes too.
    expect(nestedSetVersion('1572ba9befec980c', [{ subKey: 'SHED', version: setVersion({ name: 'Shed', subparts: [shedParts[0]!] }) }])).toBe('d281492859861154');
    expect(nestedSetVersion('1572ba9befec980c', [])).toBe('1572ba9befec980c');
  });

  type P = { key: string; partNumber: string; kind: string; subparts?: { subKey: string }[]; setVersion?: string; oldNames?: string[] };
  const catalog = (shedVersion: string): P[] => [
    { key: 'wall.1', partNumber: 'wall', kind: 'leaf' },
    { key: 'lamp.1', partNumber: 'lamp', kind: 'leaf' },
    // A library set: no version, so it never counts.
    { key: 'shed.1', partNumber: 'shed', kind: 'group', subparts: [{ subKey: 'wall.1' }] },
    { key: 'custom:s', partNumber: 'Shed', kind: 'group', subparts: [{ subKey: 'wall.1' }, { subKey: 'door.1' }], setVersion: shedVersion },
    { key: 'custom:y', partNumber: 'Yard', kind: 'group', subparts: [{ subKey: 'Shed' }, { subKey: 'lamp.1' }], setVersion: '1572ba9befec980c' },
    { key: 'custom:d', partNumber: 'Depot', kind: 'group', subparts: [{ subKey: 'yard' }, { subKey: 'shed.1' }], setVersion: 'aaaaaaaaaaaaaaaa' },
  ];

  it('finds the sets inside as the editor does, nested ones too, and leaves the others alone', () => {
    const shed = setVersion({ name: 'Shed', subparts: shedParts });
    const before = catalog(shed);
    const out = withNestedSetVersions(before);
    const v = (k: string) => out.find((p) => p.key === k)?.setVersion;
    // By number, the first one listed wins: here the library's shed, a set
    // without a version, so Yard keeps its own.
    expect(v('custom:y')).toBe('1572ba9befec980c');
    // Listed first, the custom Shed is the one found by number.
    const reordered = withNestedSetVersions([before[3]!, ...before.filter((_, i) => i !== 3)]);
    const r = (k: string) => reordered.find((p) => p.key === k)?.setVersion;
    expect(r('custom:s')).toBe(shed);
    expect(r('custom:y')).toBe('b24401c61c9daf89');
    // Depot holds Yard (which holds Shed): it follows Yard's nested version.
    expect(r('custom:d')).toBe(nestedSetVersion('aaaaaaaaaaaaaaaa', [{ subKey: 'yard', version: 'b24401c61c9daf89' }]));
    // A change to the Shed shows on both sets around it.
    const changed = withNestedSetVersions([{ ...before[3]!, setVersion: 'bbbbbbbbbbbbbbbb' }, ...before.filter((_, i) => i !== 3)]);
    expect(changed.find((p) => p.key === 'custom:y')?.setVersion).not.toBe(r('custom:y'));
    expect(changed.find((p) => p.key === 'custom:d')?.setVersion).not.toBe(r('custom:d'));
    // The parts passed in are untouched.
    expect(before[4]!.setVersion).toBe('1572ba9befec980c');
  });

  it('never counts a set it sits in, so a set holding itself still has a version', () => {
    const loop: P[] = [
      { key: 'custom:a', partNumber: 'A', kind: 'group', subparts: [{ subKey: 'B' }], setVersion: '1111111111111111' },
      { key: 'custom:b', partNumber: 'B', kind: 'group', subparts: [{ subKey: 'A' }], setVersion: '2222222222222222' },
    ];
    const out = withNestedSetVersions(loop);
    expect(out[0]!.setVersion).toBe(nestedSetVersion('1111111111111111', [{ subKey: 'B', version: nestedSetVersion('2222222222222222', []) }]));
  });
});

describe('a set naming the same set many times', () => {
  type P = { key: string; partNumber: string; kind: string; subparts?: { subKey: string }[]; setVersion?: string };
  // Each worked out every time, as before (no limit, no reuse): the versions the catalog must still give.
  const naive = (parts: P[]): P[] => {
    const index = new Map(parts.map((p) => [p.partNumber.toLowerCase(), p]));
    const versionOf = (set: P, outer: P[]): string => {
      const chain = [...outer, set];
      const inner: { subKey: string; version: string }[] = [];
      for (const sp of set.subparts ?? []) {
        const sub = index.get(sp.subKey.toLowerCase());
        if (!sub || sub.kind !== 'group' || !sub.setVersion || chain.includes(sub) || chain.length >= 16) continue;
        inner.push({ subKey: sp.subKey, version: versionOf(sub, chain) });
      }
      return nestedSetVersion(set.setVersion!, inner);
    };
    return parts.map((p) => (p.kind === 'group' && p.setVersion ? { ...p, setVersion: versionOf(p, []) } : p));
  };

  it('gets the same versions, each inner one worked out once', () => {
    // a names b three times and c; b names c twice and a (a cycle); c names a and b.
    const parts: P[] = [
      { key: 'custom:a', partNumber: 'a', kind: 'group', subparts: [{ subKey: 'b' }, { subKey: 'B' }, { subKey: 'c' }, { subKey: 'b' }], setVersion: '1111111111111111' },
      { key: 'custom:b', partNumber: 'b', kind: 'group', subparts: [{ subKey: 'c' }, { subKey: 'a' }, { subKey: 'c' }], setVersion: '2222222222222222' },
      { key: 'custom:c', partNumber: 'c', kind: 'group', subparts: [{ subKey: 'a' }, { subKey: 'b' }, { subKey: 'leaf' }], setVersion: '3333333333333333' },
      { key: 'leaf', partNumber: 'leaf', kind: 'leaf' },
    ];
    expect(withNestedSetVersions(parts).map((p) => p.setVersion)).toEqual(naive(parts).map((p) => p.setVersion));
  });

  it('keeps a set’s own version when its sets inside need too much working out', () => {
    // 20 sets each naming every other one: far more chains than the budget.
    const n = 20;
    const parts: P[] = Array.from({ length: n }, (_, i) => ({
      key: `custom:${i}`,
      partNumber: `s${i}`,
      kind: 'group',
      subparts: Array.from({ length: n }, (_, j) => ({ subKey: `s${j}` })).filter((_, j) => j !== i),
      setVersion: String(i).padStart(16, '0'),
    }));
    const started = performance.now();
    const out = withNestedSetVersions(parts);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(out).toHaveLength(n);
  });
});
