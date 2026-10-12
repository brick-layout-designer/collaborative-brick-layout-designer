// The desktop's imported part (fixtures/contracts/imported-part.xml, written
// by its ImportToPart) reads here with the fields the desktop reads, and
// nothing of its <ImportSource> reaches the parsed part.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePartXml } from './parse.js';

const CONTRACTS = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/contracts');
const xml = readFileSync(join(CONTRACTS, 'imported-part.xml'), 'utf8');
const want = JSON.parse(readFileSync(join(CONTRACTS, 'imported-part.json'), 'utf8')) as {
  author: string;
  description: string;
  pxPerStud: number;
  connections: { type: string; x: number; y: number; angle: number }[];
  snapMargin: { left: number; right: number; top: number; bottom: number };
  designer: { name: string; url: string };
  neverOnTheServer: string[];
  pickShape: [number, number][][];
};

describe('the desktop’s imported part', () => {
  const part = parsePartXml(xml, { partNumber: 'HARBOUR_YARD', colorCode: '', spritePath: '' });

  it('reads with the desktop’s fields', () => {
    expect(part.author).toBe(want.author);
    expect(part.descriptions).toMatchObject({ en: want.description });
    expect(part.pxPerStud).toBe(want.pxPerStud);
    expect(part.connections.map(({ type, x, y, angle }) => ({ type, x, y, angle }))).toEqual(want.connections);
    expect(part.snapMargin).toEqual(want.snapMargin);
    expect(part.pickShape).toEqual(want.pickShape.map((ring) => ring.map(([x, y]) => ({ x, y }))));
    expect(part.designer).toMatchObject({ name: want.designer.name, url: want.designer.url });
  });

  it('never carries the ImportSource', () => {
    const text = JSON.stringify(part);
    for (const s of want.neverOnTheServer) expect(text).not.toContain(s);
  });
});
