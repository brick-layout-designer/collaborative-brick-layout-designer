// One imported part, the same size in studs in both apps: the fixture
// (fixtures/part-scale, the same files as the desktop repo's) is an
// import's 32 px a stud .png beside its 8 px a stud .gif for vanilla.

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCatalog } from './scan.js';
import { footprint } from './footprint.js';
import { parsePartXml } from './parse.js';
import { effectivePxPerStud, spriteExtensionsFor, xmlForGifSprite } from './spriteScale.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/part-scale');
const expected = JSON.parse(readFileSync(join(FIXTURE, 'expected.json'), 'utf8')) as {
  key: string;
  studs: { w: number; h: number };
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function folderWith(exts: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'part-scale-'));
  dirs.push(dir);
  for (const ext of exts) copyFileSync(join(FIXTURE, `${expected.key}${ext}`), join(dir, `${expected.key}${ext}`));
  return dir;
}

describe('a part keeps its size in studs', () => {
  it('a hi-res import draws its .png at the XML resolution, as the desktop does', async () => {
    const { catalog } = await scanCatalog(folderWith(['.xml', '.png', '.gif']));
    const part = catalog.get(expected.key.toLowerCase());
    expect(part?.spritePath).toMatch(/\.png$/);
    expect(part?.pxPerStud).toBe(32);
    expect(footprint(part!, 0)?.size).toEqual(expected.studs);
  });

  it('a .gif is 8 px a stud whatever the XML says', async () => {
    const { catalog } = await scanCatalog(folderWith(['.xml', '.gif']));
    const part = catalog.get(expected.key.toLowerCase());
    expect(part?.spritePath).toMatch(/\.gif$/);
    expect(part?.pxPerStud).toBe(8);
    expect(footprint(part!, 0)?.size).toEqual(expected.studs);
  });

  it('a vanilla part looks for its .gif first', () => {
    expect(spriteExtensionsFor(8)[0]).toBe('.gif');
    expect(spriteExtensionsFor(32)[0]).toBe('.png');
    expect(effectivePxPerStud(32, 'a/B.GIF')).toBe(8);
    expect(effectivePxPerStud(32, 'a/b.png')).toBe(32);
  });

  it("a GIF's XML loses <PixelsPerStud> and keeps the rest", () => {
    const xml = readFileSync(join(FIXTURE, `${expected.key}.xml`), 'utf8');
    const fixed = xmlForGifSprite(xml);
    expect(fixed).not.toContain('PixelsPerStud');
    expect(fixed).toBe(xml.replace('  <PixelsPerStud>32</PixelsPerStud>\n', ''));
    const parsed = parsePartXml(fixed, { partNumber: 'SCALE', colorCode: '1', spritePath: '' });
    expect(parsed.pxPerStud).toBe(8);
    expect(parsed.descriptions.en).toContain('3 × 2 studs');
    expect(xmlForGifSprite('<part/>')).toBe('<part/>');
  });

  it('reads <PixelsPerStud> in the desktop range only', () => {
    const at = (v: string) => parsePartXml(`<part><PixelsPerStud>${v}</PixelsPerStud></part>`, { partNumber: 'X', colorCode: '', spritePath: '' }).pxPerStud;
    expect(at('32')).toBe(32);
    expect(at('4')).toBe(4);
    expect(at('3')).toBe(8);
    expect(at('257')).toBe(8);
  });
});
