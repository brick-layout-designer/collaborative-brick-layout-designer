// The keyboard inset: how much of the page the on-screen keyboard hides.

import { describe, expect, it } from 'vitest';
import { keyboardInset } from '../keyboard';

describe('keyboardInset', () => {
  it('is the height the keyboard covers', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 0 })).toBe(336);
  });
  it('allows for the page scrolled up under the keyboard (iOS)', () => {
    expect(keyboardInset(844, { height: 508, offsetTop: 120 })).toBe(216);
  });
  it('ignores browser bars moving by a few px, and no visual viewport', () => {
    expect(keyboardInset(844, { height: 790, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(844, null)).toBe(0);
  });
});
