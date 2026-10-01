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

/** The band's width for a ruler line `thickness` scene px wide. */
export function rulerHaloWidth(thickness: number): number {
  return Math.max(thickness + SELECTION.rulerHaloExtra, SELECTION.rulerHaloMin);
}

/** Konva props that make selected text glow. */
export const TEXT_GLOW = { shadowColor: SELECTION.textGlow, shadowBlur: SELECTION.textGlowBlur, shadowOpacity: 1 } as const;
