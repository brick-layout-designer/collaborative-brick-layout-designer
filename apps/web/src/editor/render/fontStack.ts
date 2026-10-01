// CSS font stack for map text. Every family a file names draws in the
// bundled map font (mapText.ts), so the map looks the same on every
// machine and in the desktop, which bundles the same font.

import { MAP_FONT_STACK } from './mapText';

export function fontStack(_family?: string): string {
  return MAP_FONT_STACK;
}
