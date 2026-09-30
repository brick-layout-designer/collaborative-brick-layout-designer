// @vitest-environment node
// The parts a .bld-layout carries (references/LAYOUT-FILE.md `parts/`).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BbmMap } from '@cld/model';
import { api, type PartWire } from '../api';
import { buildLayoutFile, isLayoutPartFileName, readLayoutFile } from '../layoutFile';
import { layoutPartFiles, planLayoutParts, uploadLayoutParts, type PartFetcher } from '../layoutParts';
import { buildZip } from '../bbmFiles';

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);
const xml = (en: string, root = 'part') => bytes(`<?xml version="1.0"?>\n<${root}>\n\t<Description>\n\t\t<en>${en}</en>\n\t</Description>\n</${root}>\n`);

function part(p: Partial<PartWire> & Pick<PartWire, 'key' | 'partNumber' | 'source'>): PartWire {
  return {
    colorCode: '',
    kind: 'leaf',
    description: '',
    sortingKey: '',
    spritePath: '',
    pxPerStud: 8,
    category: '',
    connections: [],
    subparts: [],
    hullPts: [],
    customPartId: null,
    ...p,
  };
}

const CATALOG: PartWire[] = [
  part({ key: '3001.1', partNumber: '3001', colorCode: '1', source: 'bundled' }),
  part({ key: 'custom:a', partNumber: 'MINE.1', source: 'custom', customPartId: 'a' }),
  part({ key: 'custom:k', partNumber: 'KIT.1', source: 'custom', customPartId: 'k', kind: 'group' }),
  // A custom part shadowed by a bundled one of the same key isn't carried.
  part({ key: 'custom:s', partNumber: '3001.1', source: 'custom', customPartId: 's' }),
  part({ key: 'custom:u', partNumber: 'UNUSED.1', source: 'custom', customPartId: 'u' }),
];

function mapOf(parts: string[]): BbmMap {
  return {
    layers: [{ type: 'brick', bricks: parts.map((partNumber) => ({ partNumber })) }],
  } as unknown as BbmMap;
}

const fetcher: PartFetcher = {
  xml: async (id) => bytes(`<part id="${id}"/>`),
  sprite: async (id) => ({ type: id === 'a' ? 'image/png' : 'image/gif', data: bytes(`sprite-${id}`) }),
};

afterEach(() => vi.restoreAllMocks());

describe('layout parts', () => {
  it('carries the custom parts a layout uses, each XML with its sprite', async () => {
    const files = await layoutPartFiles(mapOf(['3001.1', 'MINE.1', 'mine.1', 'KIT.1']), CATALOG, fetcher);
    expect(Object.keys(files).sort()).toEqual(['KIT.1.set.gif', 'KIT.1.set.xml', 'MINE.1.png', 'MINE.1.xml']);
    expect(new TextDecoder().decode(files['MINE.1.png'])).toBe('sprite-a');
  });

  it('goes into the file under parts/, and comes out again', async () => {
    const parts = { 'MINE.1.xml': xml('Mine'), 'MINE.1.png': bytes('png') };
    const file = await buildLayoutFile({ bbm: '<Map/>', sidecar: null, parts });
    const back = await readLayoutFile(file);
    expect(back.parts).toEqual(parts);
    expect(back.warnings).toEqual([]);
  });

  it('drops part names that would leave their folder', async () => {
    for (const ok of ['MINE.1.xml', 'KIT.1.set.xml', 'Track 18 #2.8.png', 'x.JPEG']) expect(isLayoutPartFileName(ok)).toBe(true);
    for (const bad of ['../evil.xml', 'sub/MINE.1.xml', 'sub\\MINE.1.xml', '.hidden.xml', 'C:evil.xml', 'MINE.1.exe', ''])
      expect(isLayoutPartFileName(bad)).toBe(false);
    const file = buildZip([
      { name: 'manifest.json', data: bytes('{"format":"bld-layout","version":1}') },
      { name: 'layout.bbm', data: bytes('<Map/>') },
      { name: 'parts/../../evil.xml', data: bytes('x') },
      { name: 'parts/GOOD.1.xml', data: bytes('x') },
    ]);
    const back = await readLayoutFile(file);
    expect(Object.keys(back.parts ?? {})).toEqual(['GOOD.1.xml']);
    expect(back.warnings).toHaveLength(1);
  });

  it('plans to upload only what the server lacks, with a sprite it takes', () => {
    const plan = planLayoutParts(
      {
        'MINE.1.xml': xml('Mine'),
        'MINE.1.png': bytes('png'),
        '3001.1.xml': xml('Brick'),
        'NEW.1.xml': xml('New part'),
        'NEW.1.gif': bytes('gif'),
        'NEW.1.png': bytes('png'),
        'SET.1.set.xml': xml('A set', 'group'),
        'SET.1.set.gif': bytes('gif'),
        'BARE.1.xml': xml('No sprite'),
        'JPG.1.xml': xml('Only a jpeg'),
        'JPG.1.jpg': bytes('jpg'),
      },
      CATALOG,
    );
    expect(plan.known).toEqual(['3001.1', 'MINE.1']);
    expect(plan.skipped).toEqual(['BARE.1', 'JPG.1']);
    expect(plan.upload.map((u) => [u.partNumber, u.displayName, u.spriteMime])).toEqual([
      ['NEW.1', 'New part', 'image/png'],
      ['SET.1', 'A set', 'image/gif'],
    ]);
    expect(new TextDecoder().decode(plan.upload[0]!.sprite)).toBe('png'); // the .png, as the desktop prefers
  });

  it('uploads them as custom parts and says what happened', async () => {
    const create = vi
      .spyOn(api.customParts, 'create')
      .mockImplementation(async (b) => {
        if (b.partNumber === 'BAD.1') throw new Error('500');
        return { id: 'x', partNumber: b.partNumber, displayName: b.displayName };
      });
    const notes = await uploadLayoutParts(
      {
        'NEW.1.xml': xml('New part'),
        'NEW.1.png': bytes('png'),
        'BAD.1.xml': xml('Bad'),
        'BAD.1.png': bytes('png'),
        'BARE.1.xml': xml('No sprite'),
        'MINE.1.xml': xml('Mine'),
      },
      async () => CATALOG,
      'club',
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toEqual({
      partNumber: 'NEW.1',
      displayName: 'New part',
      xmlBase64: btoa(new TextDecoder().decode(xml('New part'))),
      spriteBase64: btoa('png'),
      spriteMime: 'image/png',
      orgSlug: 'club',
    });
    expect(notes).toEqual(['1 part from the layout added to your custom parts', 'no sprite the server takes for BARE.1', 'could not upload BAD.1']);
    expect(await uploadLayoutParts(undefined, async () => CATALOG)).toEqual([]);
  });
});
