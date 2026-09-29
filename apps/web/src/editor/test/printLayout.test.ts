// Print (1 stud = 8 mm, tiled) and PDF (one fitted A3 page) — desktop
// MainWindowMenus.cpp:208-312.

import { describe, expect, it } from 'vitest';
import { buildImagePdf, dataUrlBytes, pdfPageLayout, printPixelRatio, printTiles, PRINT_MM_PER_STUD } from '../printLayout';
import { watermarkFontPx, watermarkText } from '../exportRender';

describe('printTiles — actual size', () => {
  it('prints 1 stud = 8 mm (regression: tiles were sized by dpi/96 px)', () => {
    expect(PRINT_MM_PER_STUD).toBe(8);
    // 300 dpi: 8 mm = 94.49 px per stud → 11.81 px per scene px.
    expect(printPixelRatio(300) * 8).toBeCloseTo((300 / 25.4) * 8, 9);
  });

  it('tiles butt-joined like desktop by default', () => {
    // A3 landscape 420 × 297 mm, no margin: tiles of 52.5 × 37.125 studs.
    const t = printTiles({ x: 0, y: 0, width: 100, height: 40 }, { w: 420, h: 297 });
    expect([t.cols, t.rows]).toEqual([2, 2]);
    expect(t.tileMm).toEqual({ w: 420, h: 297 });
    expect(t.tiles[1]).toEqual({ x: 52.5, y: 0, width: 52.5, height: 37.125 });
    expect(t.tiles[2]).toEqual({ x: 0, y: 37.125, width: 52.5, height: 37.125 });
  });

  it('subtracts page margins and steps by the overlap', () => {
    const t = printTiles({ x: 5, y: 5, width: 50, height: 10 }, { w: 210, h: 297 }, 10, 16);
    // Printable 190 × 277 mm = 23.75 × 34.625 studs, overlap 2 studs → step 21.75.
    expect(t.tileMm).toEqual({ w: 190, h: 277 });
    expect(t.cols).toBe(3);
    expect(t.rows).toBe(1);
    expect(t.tiles[1]!.x).toBeCloseTo(26.75, 9);
  });

  it('a map smaller than a page is one page', () => {
    expect(printTiles({ x: 0, y: 0, width: 1, height: 1 }, { w: 210, h: 297 }).tiles).toHaveLength(1);
  });
});

describe('pdfPageLayout — one A3 page', () => {
  it('is landscape for wide or square layouts, portrait for tall ones', () => {
    expect(pdfPageLayout({ width: 200, height: 100 })).toMatchObject({ landscape: true, pageMm: { w: 420, h: 297 } });
    expect(pdfPageLayout({ width: 100, height: 100 }).landscape).toBe(true);
    expect(pdfPageLayout({ width: 50, height: 100 })).toMatchObject({ landscape: false, pageMm: { w: 297, h: 420 } });
  });

  it('fits the map inside 12 mm margins, centred, keeping the aspect', () => {
    const l = pdfPageLayout({ width: 100, height: 100 });
    // Paint area 396 × 273: height-limited square, centred horizontally.
    expect(l.imageMm).toEqual({ x: 12 + (396 - 273) / 2, y: 12, w: 273, h: 273 });
  });
});

describe('buildImagePdf', () => {
  const jpeg = dataUrlBytes('data:image/jpeg;base64,/9j/4AAQ2Q==');

  it('writes a valid one-page PDF with a correct xref', () => {
    const layout = pdfPageLayout({ width: 200, height: 100 });
    const bytes = buildImagePdf(layout, { bytes: jpeg, width: 20, height: 10 }, 'My (Layout)');
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 1190.551 841.89]');
    expect(text).toContain('/Width 20 /Height 10');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Title (My \\(Layout\\))');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
    // Image placed with PDF's bottom-left origin: 396 mm wide, centred vertically.
    const cm = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(text)!;
    expect(Number(cm[1])).toBeCloseTo((396 * 72) / 25.4, 2);
    expect(Number(cm[3])).toBeCloseTo((12 * 72) / 25.4, 2);
    expect(Number(cm[4])).toBeCloseTo(((297 - 198) / 2) * (72 / 25.4), 2);
  });
});

describe('export watermark', () => {
  it('always writes "author / LUG / event"', () => {
    expect(watermarkText({ author: 'Ann', lug: 'BayLUG', event: 'Show' })).toBe('Ann / BayLUG / Show');
    expect(watermarkText({ author: '', lug: '', event: 'Show' })).toBe(' /  / Show');
  });
  it('sizes the font as max(8, h/60) points', () => {
    expect(watermarkFontPx(600)).toBeCloseTo((10 * 96) / 72, 9);
    expect(watermarkFontPx(100)).toBeCloseTo((8 * 96) / 72, 9);
  });
});
