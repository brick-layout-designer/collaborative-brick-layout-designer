// Print and PDF page geometry — port of desktop File ▸ Print and
// File ▸ Export as PDF (MainWindowMenus.cpp:208-312).
//
//   Print: actual size, 1 stud = 8 mm on paper, the map tiled across as
//          many pages as it needs (a paste-up).
//   PDF:   one A3 page, landscape when the layout is at least as wide as
//          it is tall, 12 mm margins, the map fitted (aspect kept, centred).
//
// Pure geometry plus a minimal PDF writer (one page, one JPEG image), so
// the web bundle needs no PDF library.

import type { StudRect } from './exportRender';

/** BlueBrick convention for actual-size output: 1 stud = 8 mm. */
export const PRINT_MM_PER_STUD = 8;

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;

/** Output px per scene px (8 scene px per stud) when printing 1:1 at `dpi`. */
export function printPixelRatio(dpi: number): number {
  return (dpi / MM_PER_INCH) * PRINT_MM_PER_STUD / 8;
}

export interface PrintTiling {
  cols: number;
  rows: number;
  /** Printable tile size on paper, mm. */
  tileMm: { w: number; h: number };
  /** Map region each page shows, studs, row-major. */
  tiles: StudRect[];
}

/**
 * Tile `region` (studs) across pages of `paperMm` at 1 stud = 8 mm. The
 * printable area is the paper minus `marginMm` per side; consecutive
 * tiles share `overlapMm` (0 = desktop's butt-joined paste-up).
 */
export function printTiles(
  region: StudRect,
  paperMm: { w: number; h: number },
  marginMm = 0,
  overlapMm = 0,
): PrintTiling {
  const tileMm = { w: Math.max(1, paperMm.w - 2 * marginMm), h: Math.max(1, paperMm.h - 2 * marginMm) };
  const tileW = tileMm.w / PRINT_MM_PER_STUD;
  const tileH = tileMm.h / PRINT_MM_PER_STUD;
  const ov = Math.max(0, Math.min(overlapMm / PRINT_MM_PER_STUD, Math.min(tileW, tileH) / 2));
  const stepX = tileW - ov;
  const stepY = tileH - ov;
  const cols = Math.max(1, Math.ceil((region.width - ov) / stepX - 1e-9));
  const rows = Math.max(1, Math.ceil((region.height - ov) / stepY - 1e-9));
  const tiles: StudRect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({ x: region.x + c * stepX, y: region.y + r * stepY, width: tileW, height: tileH });
    }
  }
  return { cols, rows, tileMm, tiles };
}

export interface PdfPageLayout {
  /** Page size in mm (A3, orientation applied). */
  pageMm: { w: number; h: number };
  landscape: boolean;
  /** Where the map image goes on the page, mm from the top-left. */
  imageMm: { x: number; y: number; w: number; h: number };
}

/** A3, landscape when width ≥ height, 12 mm margins, map fitted and centred (Qt::KeepAspectRatio). */
export function pdfPageLayout(region: { width: number; height: number }, marginMm = 12): PdfPageLayout {
  const landscape = region.width >= region.height;
  const pageMm = landscape ? { w: 420, h: 297 } : { w: 297, h: 420 };
  const paint = { w: pageMm.w - 2 * marginMm, h: pageMm.h - 2 * marginMm };
  const k = Math.min(paint.w / Math.max(region.width, 1e-9), paint.h / Math.max(region.height, 1e-9));
  const w = region.width * k;
  const h = region.height * k;
  return {
    pageMm,
    landscape,
    imageMm: { x: marginMm + (paint.w - w) / 2, y: marginMm + (paint.h - h) / 2, w, h },
  };
}

/**
 * One-page PDF showing a JPEG at `layout.imageMm`. The image is embedded
 * as-is (DCTDecode), so the file is little more than the JPEG.
 */
export function buildImagePdf(
  layout: PdfPageLayout,
  jpeg: { bytes: Uint8Array; width: number; height: number },
  title = '',
): Uint8Array {
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const W = layout.pageMm.w * PT_PER_MM;
  const H = layout.pageMm.h * PT_PER_MM;
  const iw = layout.imageMm.w * PT_PER_MM;
  const ih = layout.imageMm.h * PT_PER_MM;
  const ix = layout.imageMm.x * PT_PER_MM;
  // PDF y runs up from the bottom of the page.
  const iy = H - (layout.imageMm.y * PT_PER_MM + ih);
  const content = `q ${f(iw)} 0 0 ${f(ih)} ${f(ix)} ${f(iy)} cm /Im0 Do Q`;
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');

  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'.replace(/[\u0080-ÿ]/g, 'x'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = pos;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bytes.length} >>\nstream\n`);
  push(jpeg.bytes);
  push('\nendstream\nendobj\n');
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title (${esc(title)}) /Producer (Brick Layout Designer) >>`);
  const xref = pos;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let n = 1; n <= 6; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Decode a `data:image/jpeg;base64,…` URL to bytes. */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
