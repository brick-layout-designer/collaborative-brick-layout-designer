// How a selection looks, the same as the desktop (ui/SelectionStyle.h):
// a part gets a black and gold double outline 1 px outside its picture
// with a see-through gold fill (green while a connection snap is live);
// text and labels glow gold; a ruler gets a see-through gold band along
// its line and round gold endpoint handles. render-parity/selection.json
// holds the numbers both apps are tested against.

export const SELECTION = {
  partPadPx: 1,
  partOuter: 'rgba(0,0,0,0.9)',
  partOuterWidth: 5,
  partInnerWidth: 2.5,
  partFillAlpha: 0x4d,
  snapStroke: 'rgb(80,255,120)',
  snapFill: 'rgba(80,255,120,0.353)',
  textGlow: '#ffcc00',
  textGlowBlur: 8,
  rulerHalo: 'rgba(255,215,0,0.5)',
  rulerHaloExtra: 4,
  rulerHaloMin: 6,
  handleRadius: 6,
  handleFill: 'rgb(255,215,0)',
  handleStroke: 'rgb(20,20,20)',
  handleStrokeWidth: 1.5,
} as const;

/**
 * Connection-snap marks while dragging, in screen px at any zoom: a green
 * ring (with a light halo, readable on dark and light backgrounds) on the
 * target connection, an amber dot on the moving connection that joins.
 * Same as the desktop (SelectionStyle.h, namespace snapmarks).
 */
export const SNAP_MARKS = {
  ring: 'rgb(22,163,74)',
  ringRadius: 9,
  ringWidth: 2.5,
  ringFill: 'rgba(34,197,94,0.2)',
  halo: 'rgba(255,255,255,0.8)',
  haloWidth: 1.5,
  dot: 'rgb(245,158,11)',
  dotRadius: 4,
  dotHaloWidth: 1.5,
} as const;

/** The band's width for a ruler line `thickness` scene px wide. */
export function rulerHaloWidth(thickness: number): number {
  return Math.max(thickness + SELECTION.rulerHaloExtra, SELECTION.rulerHaloMin);
}

/** Konva props that make selected text glow. */
export const TEXT_GLOW = { shadowColor: SELECTION.textGlow, shadowBlur: SELECTION.textGlowBlur, shadowOpacity: 1 } as const;
