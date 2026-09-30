// Phones leave out canvas text too small to read; grid labels grow instead.

import { describe, expect, it } from 'vitest';
import { legibleLabelPx, PHONE_MIN_TEXT_PX, textReadable } from '../textLegibility';

describe('textReadable', () => {
  it('draws everything when there is no threshold (desktop)', () => {
    expect(textReadable(10, 0.01, 0)).toBe(true);
    // An unset threshold never hides text.
    expect(textReadable(10, 0.01, Number.NaN)).toBe(true);
  });

  it('hides text smaller than the threshold on screen, and shows it at and above', () => {
    // 200 scene px at 4% = 8 px on screen.
    expect(textReadable(200, 0.04, PHONE_MIN_TEXT_PX)).toBe(true);
    expect(textReadable(200, 0.039, PHONE_MIN_TEXT_PX)).toBe(false);
    expect(textReadable(200, 1, PHONE_MIN_TEXT_PX)).toBe(true);
  });
});

describe('legibleLabelPx', () => {
  it('keeps a readable label at its own size', () => {
    expect(legibleLabelPx(107, 0.5, PHONE_MIN_TEXT_PX, 460)).toBe(107);
    expect(legibleLabelPx(107, 0.01, 0, 460)).toBe(107);
  });

  it('grows a tiny label to about 11 px on screen while it fits its cell', () => {
    // 107 px at 3% is 3.2 px on screen; the 768 px cell allows 460 px.
    const px = legibleLabelPx(107, 0.03, PHONE_MIN_TEXT_PX, 460)!;
    expect(px * 0.03).toBeCloseTo(11, 6);
  });

  it('grows only as far as the cell, and drops it when that is still unreadable', () => {
    // Cell room 300 px at 3% = 9 px: grown to 9 px, not 11.
    expect(legibleLabelPx(107, 0.03, PHONE_MIN_TEXT_PX, 300)! * 0.03).toBeCloseTo(9, 6);
    // Room for 6 px only: left out.
    expect(legibleLabelPx(107, 0.03, PHONE_MIN_TEXT_PX, 200)).toBeNull();
  });
});
