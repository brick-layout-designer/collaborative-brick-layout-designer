// Save selection as set (setXml.ts): the set's XML, its part number, and
// renaming it — the same shape the desktop's SetIO writes and renames.

import { describe, expect, it } from 'vitest';
import { parsePartXml } from '@cld/parts-catalog/browser';
import type { Brick } from '@cld/model';
import type { PartWire } from '../../api';
import { indexParts } from '../partIndex';
import { buildSetXml, renameSetXml, setPartNumber, setSubparts } from '../setXml';

const brick = (partNumber: string, x: number, y: number, orientation = 0): Brick => ({
  id: `${partNumber}-${x}`,
  displayArea: { x, y, width: 8, height: 8 },
  myGroup: '',
  partNumber,
  orientation,
  activeConnectionPointIndex: 0,
  altitude: 0,
  connexions: [],
});

const part = (p: Partial<PartWire> & Pick<PartWire, 'key' | 'partNumber' | 'source'>): PartWire =>
  ({ colorCode: '', description: '', category: '', connections: [], subparts: [], kind: 'leaf', customPartId: null, hullPts: [], pxPerStud: 8, ...p }) as unknown as PartWire;

describe('save selection as set', () => {
  const index = indexParts([
    part({ key: '3001.1', partNumber: '3001', source: 'bundled' }),
    part({ key: 'custom:abc', partNumber: 'MY_STATION', source: 'custom', customPartId: 'abc' }),
  ]);

  it('puts the parts around their middle, a custom part by its number', () => {
    const subs = setSubparts([brick('3001.1', 0, 0, 90), brick('custom:abc', 16, 0)], index);
    expect(subs).toEqual([
      { partKey: '3001.1', x: -8, y: 0, angle: 90 },
      { partKey: 'MY_STATION', x: 8, y: 0, angle: 0 },
    ]);
  });

  it('writes a <group> the parts reader takes as a set of those parts', () => {
    const xml = buildSetXml('Station & yard', setSubparts([brick('3001.1', 0, 0), brick('custom:abc', 16, 0)], index));
    const parsed = parsePartXml(xml, { partNumber: 'set', colorCode: '', spritePath: '' });
    expect(parsed.kind).toBe('group');
    expect(parsed.subparts.map((s) => s.subKey.toLowerCase())).toEqual(['3001.1', 'my_station']);
    expect(xml).toContain('<en>Station &amp; yard</en>');
  });

  it('names it as the desktop names its file, without .set.xml', () => {
    expect(setPartNumber('Main yard')).toBe('Main yard');
    expect(setPartNumber('a/b: c?')).toBe('a_b_ c_');
    expect(setPartNumber('Yard.set')).toBe('Yard');
    expect(setPartNumber(' . ')).toBe('Set');
  });

  it('renaming changes only the English name', () => {
    const xml = buildSetXml('Old', [{ partKey: '3001.1', x: 0, y: 0, angle: 0 }]).replace('</en>', '</en><de>Alt</de>');
    const renamed = renameSetXml(xml, 'New <one>');
    expect(renamed).toContain('<en>New &lt;one&gt;</en>');
    expect(renamed).toContain('<de>Alt</de>');
    expect(renamed.replace('<en>New &lt;one&gt;</en>', '<en>Old</en>')).toBe(xml);
  });

  it('renaming a set without a name gives it one', () => {
    expect(renameSetXml('<group><SubPartList/></group>', 'Yard')).toBe('<group><Description><en>Yard</en></Description><SubPartList/></group>');
    expect(renameSetXml('<group><Description><fr>Gare</fr></Description></group>', 'Yard')).toBe(
      '<group><Description><en>Yard</en><fr>Gare</fr></Description></group>',
    );
  });
});
