// Anchored-label color helpers. `AnchoredLabel.color` is
// `{ known, argb, name }`, as desktop's SidecarIO.cpp encodeColor writes it.

import type { AnchoredLabel } from '@cld/bbm';

type LabelColor = AnchoredLabel['color'];

/**
 * `RRGGBB` (uppercase, no `#`) of a label color. Desktop always writes
 * `argb` and reads the color from it (SidecarIO.cpp decodeColor); `name`
 * only records which .NET KnownColor it was. A known color with no argb
 * falls back to a small name lookup, then black so the label is visible.
 */
export function labelColorHex(c: LabelColor): string {
  if (c.known && !c.argb) {
    const known: Record<string, string> = {
      black: '000000',
      white: 'FFFFFF',
      red: 'FF0000',
      green: '008000',
      blue: '0000FF',
      yellow: 'FFFF00',
      orange: 'FFA500',
    };
    return known[(c.name ?? '').toLowerCase()] ?? '000000';
  }
  // 32-bit AARRGGBB: keep RGB; alpha handled by Konva opacity if needed.
  return ((c.argb >>> 0) & 0xffffff).toString(16).toUpperCase().padStart(6, '0');
}

/**
 * The color a label dialog saves. An edited label keeps its original
 * color spec (known colors included) unless the user picked a new one,
 * so an edit never rewrites "Black" as plain ARGB; otherwise the picked
 * `AARRGGBB` hex becomes a plain ARGB color.
 */
export function labelColorToSave(initial: LabelColor | undefined, touched: boolean, argbHex: string): LabelColor {
  if (initial && !touched) return initial;
  return { known: false, argb: parseInt(argbHex, 16), name: '' };
}
