// Canvas text that is too small to read is only noise on a phone: at the
// zoom that fits a whole layout on a 400 px screen, labels shrink to a few
// pixels and rotated ones turn into smudges. Below the threshold we leave
// them out; they come back as soon as the user zooms in.
//
// Desktop keeps drawing every label (the BlueBrick look), so the threshold
// is 0 there.

/** Smallest on-screen text height, in CSS px, that we draw on a phone. */
export const PHONE_MIN_TEXT_PX = 8;

/** Whether text of `fontScenePx` (scene px at zoom 1) is drawn at `zoom`. */
export function textReadable(fontScenePx: number, zoom: number, minScreenPx: number): boolean {
  if (!(minScreenPx > 0)) return true;
  return fontScenePx * zoom >= minScreenPx;
}

/** On-screen size a grown label aims for: comfortably readable, not huge. */
const GROWN_LABEL_PX = 11;

/**
 * Font size (scene px) for a label that has room to grow, like the grid's
 * A, B, C… cell labels: its own size when readable, else grown towards
 * GROWN_LABEL_PX on screen as far as `maxScenePx` (its cell) allows; null
 * when it can't even reach the readable minimum, so it's left out.
 */
export function legibleLabelPx(fontScenePx: number, zoom: number, minScreenPx: number, maxScenePx: number): number | null {
  if (textReadable(fontScenePx, zoom, minScreenPx)) return fontScenePx;
  if (!(zoom > 0)) return null;
  const grown = Math.min(Math.max(GROWN_LABEL_PX, minScreenPx) / zoom, maxScenePx);
  return grown * zoom >= minScreenPx ? grown : null;
}
