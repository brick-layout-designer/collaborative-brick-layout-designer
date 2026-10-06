// The arithmetic behind CoverPicker: where an uploaded picture sits on a
// 4:3 card, how far it can be zoomed and moved, and how the final picture is
// drawn. All in the card's own pixels (CARD_W × CARD_H, the size uploaded);
// the preview draws the same thing smaller, so what you see is what's sent.

/** The uploaded picture: 4:3 like every catalog card, as wide as the server keeps. */
export const CARD_W = 1200;
export const CARD_H = 900;

/** How the picture sits: its scale (card px per picture px) and its centre's offset from the card's. */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

const CARD: Size = { w: CARD_W, h: CARD_H };

/** The whole picture shows (bands at the sides, or top and bottom, when its shape differs). */
export const fitZoom = (img: Size, box: Size = CARD) => Math.min(box.w / img.w, box.h / img.h);
/** The picture covers the whole card (some of it is cut off when its shape differs). */
export const fillZoom = (img: Size, box: Size = CARD) => Math.max(box.w / img.w, box.h / img.h);

/** The zoom slider's ends: from the whole picture to four times "fill". */
export function zoomRange(img: Size, box: Size = CARD): { min: number; max: number } {
  return { min: fitZoom(img, box), max: fillZoom(img, box) * 4 };
}

/**
 * Keep a crop sensible: zoom within the range, and the picture can't be
 * dragged off the card. A side bigger than the card can move until its edge
 * meets the card's; a side smaller than the card can move until it touches
 * the card's edge.
 */
export function clampCrop(c: Crop, img: Size, box: Size = CARD): Crop {
  const { min, max } = zoomRange(img, box);
  const zoom = Math.min(max, Math.max(min, Number.isFinite(c.zoom) ? c.zoom : min));
  const limX = Math.abs(img.w * zoom - box.w) / 2;
  const limY = Math.abs(img.h * zoom - box.h) / 2;
  const clamp = (v: number, lim: number) => Math.min(lim, Math.max(-lim, Number.isFinite(v) ? v : 0));
  return { zoom, x: clamp(c.x, limX), y: clamp(c.y, limY) };
}

/** "Fit": the whole picture, centred. */
export const fitCrop = (img: Size, box: Size = CARD): Crop => ({ zoom: fitZoom(img, box), x: 0, y: 0 });
/** "Fill": covers the card, centred. */
export const fillCrop = (img: Size, box: Size = CARD): Crop => ({ zoom: fillZoom(img, box), x: 0, y: 0 });

/** Where the picture is drawn on the card. */
export function drawRect(c: Crop, img: Size, box: Size = CARD): { x: number; y: number; w: number; h: number } {
  const w = img.w * c.zoom;
  const h = img.h * c.zoom;
  return { x: box.w / 2 + c.x - w / 2, y: box.h / 2 + c.y - h / 2, w, h };
}

/** Whether the picture covers the whole card (no background shows). */
export function coversCard(c: Crop, img: Size, box: Size = CARD): boolean {
  const r = drawRect(c, img, box);
  const e = 0.5;
  return r.x <= e && r.y <= e && r.x + r.w >= box.w - e && r.y + r.h >= box.h - e;
}

/** Move by (dx, dy) card pixels. */
export const panCrop = (c: Crop, dx: number, dy: number, img: Size, box: Size = CARD): Crop => clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, img, box);

/** Zoom to `zoom`, keeping the card point (px, py) still (under a finger or the pointer). */
export function zoomAbout(c: Crop, zoom: number, px: number, py: number, img: Size, box: Size = CARD): Crop {
  const z = clampCrop({ ...c, zoom }, img, box).zoom;
  // The picture point under (px, py), relative to the picture's centre, in picture pixels.
  const u = (px - box.w / 2 - c.x) / c.zoom;
  const v = (py - box.h / 2 - c.y) / c.zoom;
  return clampCrop({ zoom: z, x: px - box.w / 2 - u * z, y: py - box.h / 2 - v * z }, img, box);
}

/** Whether any pixel is see-through: RGBA bytes, as a canvas gives them. */
export function anyTransparent(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if ((rgba[i] ?? 255) < 250) return true;
  return false;
}

/** What a 2D canvas needs to draw a cover (the part of CanvasRenderingContext2D used). */
export interface CoverCtx {
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingQuality?: ImageSmoothingQuality;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: CanvasImageSource, x: number, y: number, w: number, h: number): void;
}

/**
 * Draw the cover on a `w` × `h` canvas (the card, or the preview: the same
 * 4:3 shape, so one scale): the background first, so a see-through picture, or the bands
 * beside a fitted one, show that colour; then the picture.
 */
export function composeCover(ctx: CoverCtx, img: CanvasImageSource, size: Size, c: Crop, background: string, w = CARD_W, h = CARD_H): void {
  const s = w / CARD_W;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  const r = drawRect(c, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x * s, r.y * s, r.w * s, r.h * s);
}
