// Stage coordinate conventions:
//   - The Konva Stage is in *pixels*. The world model is in *studs*.
//   - 1 stud = STUD_PX pixels at zoom = 1.
//   - We keep the conversion factor centralised here so a future "pixel-
//     perfect" mode (e.g. rendering at custom DPI) only touches this file.
//
// The desktop uses 8 px/stud as its native render scale (matching vanilla
// BlueBrick's GIF sprites, which are sized at this density).

export const STUD_PX = 8;

export function studToPx(studs = 1): number {
  return studs * STUD_PX;
}

export function pxToStud(px: number): number {
  return px / STUD_PX;
}

export const COLOR_DEFAULT = '#404040';
