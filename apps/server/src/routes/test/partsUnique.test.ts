// The catalog lists each part key once, keeping the entry the editor
// draws (the last one), so a part from two libraries isn't shown twice.

import { describe, expect, it } from 'vitest';
import { uniqueByKey } from '../parts.js';

type PartWire = Parameters<typeof uniqueByKey>[0][number];

const part = (key: string, description: string) => ({ key, description }) as unknown as PartWire;

describe('uniqueByKey', () => {
  it('keeps one entry per key, the last one, ignoring case', () => {
    const out = uniqueByKey([part('10017-1.set', 'base'), part('3811.2', 'plate'), part('10017-1.SET', 'custom')]);
    expect(out.map((p) => p.description)).toEqual(['plate', 'custom']);
  });

  it('leaves distinct keys alone', () => {
    const out = uniqueByKey([part('a', '1'), part('b', '2')]);
    expect(out.map((p) => p.key)).toEqual(['a', 'b']);
  });
});
