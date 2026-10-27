// A set's version (setVersion.ts): the same text and digest the desktop's
// parts::setVersion makes (its SetVersionTest has these vectors), changing
// with the set's parts, where they sit, or its name, and with nothing else.

import { describe, expect, it } from 'vitest';
import { setVersion, setVersionText } from './setVersion.js';

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
