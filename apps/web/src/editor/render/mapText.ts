// The map's text, drawn the same way as the desktop draws it
// (src/rendering/MapText.h there): one bundled font, Liberation Sans
// (metric-compatible with Arial, so with the sizes BlueBrick's files store),
// whatever family a file names, so the text looks the same on every
// machine; lines 2355/2048 em apart (GDI+'s Arial line spacing, as
// BlueBrick draws them). packages/bbm/tests/fixtures/render-parity/
// text.json holds the numbers both apps are tested against.

import type { TextCell } from '@cld/model';
import { studToPx } from './coords';

export const MAP_FONT_FAMILY = 'BLD Map Sans';
/** The font stack every piece of map text uses. */
export const MAP_FONT_STACK = `"${MAP_FONT_FAMILY}", "Liberation Sans", Arial, sans-serif`;
/** Line spacing in em (the font's ascent + descent + line gap). */
export const MAP_LINE_HEIGHT = 2355 / 2048;

const FACES = ['400 normal', '700 normal', '400 italic', '700 italic'];

/** Resolves once the bundled faces are loaded (canvas text falls back to another font before). */
export function mapFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  return Promise.all(
    FACES.map((f) => {
      const [weight, style] = f.split(' ');
      return document.fonts.load(`${style} ${weight} 16px "${MAP_FONT_FAMILY}"`).catch(() => []);
    }),
  ).then(() => undefined);
}

/** A line's width in px at a font size. */
export type LineWidthAt = (line: string, fontPx: number) => number;

export interface TextCellLayout {
  fontPx: number;
  /** The text's box before turning. */
  width: number;
  height: number;
  /** Scene px; the box turns `rotation`° about it. */
  centre: { x: number; y: number };
  rotation: number;
  /** Each line's top-left in the box. */
  lines: { text: string; x: number; y: number }[];
}

const PROBE_PX = 100;

/**
 * A text cell's text, fitted into its display area (the biggest font that
 * fits both sides), centred on it, lines aligned Near / Center / Far.
 */
export function textCellLayout(
  cell: Pick<TextCell, 'text' | 'displayArea' | 'orientation' | 'textAlignment'>,
  widthAt: LineWidthAt,
): TextCellLayout {
  const k = studToPx();
  const lines = cell.text.split('\n');
  const widest = (px: number) => Math.max(0, ...lines.map((l) => widthAt(l, px)));
  const orient = ((cell.orientation % 360) + 360) % 360;
  const rot90 = Math.abs(orient - 90) < 1 || Math.abs(orient - 270) < 1;
  const boxW = (rot90 ? cell.displayArea.height : cell.displayArea.width) * k;
  const boxH = (rot90 ? cell.displayArea.width : cell.displayArea.height) * k;
  const probeW = widest(PROBE_PX);
  const probeH = lines.length * MAP_LINE_HEIGHT * PROBE_PX;
  const fontPx = probeW > 0 && probeH > 0 ? Math.max(1, Math.floor(PROBE_PX * Math.min(boxW / probeW, boxH / probeH))) : PROBE_PX;
  const width = widest(fontPx);
  const align = (cell.textAlignment ?? 'Center').toLowerCase();
  return {
    fontPx,
    width,
    height: lines.length * MAP_LINE_HEIGHT * fontPx,
    centre: { x: (cell.displayArea.x + cell.displayArea.width / 2) * k, y: (cell.displayArea.y + cell.displayArea.height / 2) * k },
    rotation: cell.orientation,
    lines: lines.map((text, i) => {
      const lw = widthAt(text, fontPx);
      const x = align === 'center' ? (width - lw) / 2 : align === 'far' ? width - lw : 0;
      return { text, x, y: i * MAP_LINE_HEIGHT * fontPx };
    }),
  };
}
