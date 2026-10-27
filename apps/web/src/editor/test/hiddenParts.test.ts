// Parts only used inside sets (hiddenParts.ts): which parts a set opens to
// (a set inside it too, never itself again), and why one isn't placed alone.

import { describe, expect, it } from 'vitest';
import type { PartWire } from '../../api';
import { indexParts } from '../partIndex';
import { hiddenPartNotice, partsInSet } from '../hiddenParts';

const part = (key: string, extra: Partial<PartWire> = {}) =>
  ({ key, partNumber: key, colorCode: '', kind: 'leaf', description: key, subparts: [], source: 'bundled', ...extra }) as unknown as PartWire;
const set = (key: string, subKeys: string[]) =>
  part(key, { kind: 'group', subparts: subKeys.map((subKey) => ({ subKey, x: 0, y: 0, angle: 0 })) } as Partial<PartWire>);

describe('parts only used inside sets', () => {
  it('a set opens to its parts, and a set inside it opens too', () => {
    const parts = indexParts([
      set('flex', ['half.a', 'half.b']),
      set('yard', ['flex', 'shed', 'shed']),
      part('half.a', { notListed: true }),
      part('half.b', { notListed: true }),
      part('shed'),
      part('other'),
    ]);
    expect([...partsInSet(parts, parts.get('yard')!)].sort()).toEqual(['flex', 'half.a', 'half.b', 'shed']);
    expect([...partsInSet(parts, parts.get('shed')!)]).toEqual([]);
  });

  it('a set named like one of its parts opens to that part, not itself', () => {
    const parts = indexParts([set('custom:s', ['yard']), part('custom:p', { partNumber: 'YARD', source: 'custom' } as Partial<PartWire>)].map((p, i) => (i === 0 ? { ...p, partNumber: 'YARD', source: 'custom' } : p)) as PartWire[]);
    expect([...partsInSet(parts, parts.get('custom:s')!)]).toEqual(['custom:p']);
  });

  it('says why one isn’t placed by itself', () => {
    expect(hiddenPartNotice(part('88492.8', { description: 'Flex track female half' }))).toBe(
      '“Flex track female half” is only used inside a set, so it isn’t placed by itself. Place its set instead.',
    );
  });
});
