import { describe, expect, it } from 'vitest';
import { fitOnScreen } from '../menuPosition';

describe('fitOnScreen', () => {
  it('leaves a menu that fits where the pointer was', () => {
    expect(fitOnScreen(100, 200, 170, 300, 1280, 720)).toEqual({ left: 100, top: 200 });
  });
  it('moves a menu opened near the bottom up so all of it shows', () => {
    expect(fitOnScreen(1100, 620, 170, 300, 1280, 720)).toEqual({ left: 1100, top: 416 });
  });
  it('moves a menu opened near the right edge to the left', () => {
    expect(fitOnScreen(1250, 100, 170, 300, 1280, 720)).toEqual({ left: 1106, top: 100 });
  });
  it('keeps the top of a menu taller than the window on screen', () => {
    expect(fitOnScreen(10, 50, 170, 900, 1280, 720).top).toBe(4);
  });
});
