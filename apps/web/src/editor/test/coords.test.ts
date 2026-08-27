import { describe, expect, it } from 'vitest';
import { STUD_PX, studToPx, pxToStud, COLOR_DEFAULT } from '../render/coords';

describe('STUD_PX', () => {
  it('equals 8', () => {
    expect(STUD_PX).toBe(8);
  });
});

describe('studToPx', () => {
  it('converts 1 stud to 8 pixels', () => {
    expect(studToPx(1)).toBe(8);
  });

  it('converts 0 studs to 0 pixels', () => {
    expect(studToPx(0)).toBe(0);
  });

  it('converts fractional studs', () => {
    expect(studToPx(0.5)).toBe(4);
  });

  it('converts large values linearly', () => {
    expect(studToPx(100)).toBe(800);
  });

  it('defaults to 1 stud when called with no arguments', () => {
    expect(studToPx()).toBe(8);
  });

  it('handles negative studs', () => {
    expect(studToPx(-3)).toBe(-24);
  });

  it('is the inverse of pxToStud', () => {
    expect(studToPx(pxToStud(160))).toBe(160);
  });
});

describe('pxToStud', () => {
  it('converts 8 pixels to 1 stud', () => {
    expect(pxToStud(8)).toBe(1);
  });

  it('converts 0 pixels to 0 studs', () => {
    expect(pxToStud(0)).toBe(0);
  });

  it('converts fractional pixels', () => {
    expect(pxToStud(4)).toBe(0.5);
  });

  it('converts large pixel values', () => {
    expect(pxToStud(800)).toBe(100);
  });

  it('handles negative pixels', () => {
    expect(pxToStud(-24)).toBe(-3);
  });

  it('is the inverse of studToPx', () => {
    expect(pxToStud(studToPx(17))).toBe(17);
  });

  it('round-trips: pxToStud(studToPx(n)) === n for arbitrary n', () => {
    for (const n of [0, 1, 5, 12.5, 100, 0.25]) {
      expect(pxToStud(studToPx(n))).toBeCloseTo(n);
    }
  });
});

describe('COLOR_DEFAULT', () => {
  it('is a hex color string', () => {
    expect(COLOR_DEFAULT).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('equals #404040', () => {
    expect(COLOR_DEFAULT).toBe('#404040');
  });
});
