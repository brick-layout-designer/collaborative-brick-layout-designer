import { describe, expect, it } from 'vitest';
import { formatBool, formatInt, formatNumber, parseBool } from './format.js';

describe('formatNumber', () => {
  it('emits integers without a decimal point', () => {
    // C#'s Single/Double.ToString() collapses 1.0 → "1". Match it.
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(-1)).toBe('-1');
    expect(formatNumber(1000)).toBe('1000');
  });

  it('keeps the decimal portion for non-integral values', () => {
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(190.5)).toBe('190.5');
    expect(formatNumber(95.25)).toBe('95.25');
  });

  it('strips trailing zeros and trailing dots', () => {
    // 0.5 stored as a double is exact; 0.50000 must print as "0.5".
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(2.5)).toBe('2.5');
  });

  it('normalises -0 to 0 (no leading minus on integral zero)', () => {
    expect(formatNumber(-0)).toBe('0');
  });

  it('throws on non-finite values', () => {
    expect(() => formatNumber(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatNumber(Number.NaN)).toThrow();
  });

  it('respects g7 precision for float fields', () => {
    // 1/3 ≈ 0.3333333... -> 7 sig digits is "0.3333333"
    expect(formatNumber(1 / 3, 'g7')).toBe('0.3333333');
    // and g15 keeps more digits
    expect(formatNumber(1 / 3, 'g15')).toBe('0.333333333333333');
  });
});

describe('formatInt', () => {
  it('round-trips integers', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(42)).toBe('42');
    expect(formatInt(-7)).toBe('-7');
  });

  it('truncates floats rather than throwing', () => {
    // Important: callers may pass JS numbers that came from the parser as
    // floats (parseFloat returns a number for "0", which is integral).
    expect(formatInt(3.7)).toBe('3');
    expect(formatInt(-3.7)).toBe('-3');
  });
});

describe('formatBool / parseBool', () => {
  it('emits lowercase', () => {
    expect(formatBool(true)).toBe('true');
    expect(formatBool(false)).toBe('false');
  });

  it('parses lowercase', () => {
    expect(parseBool('true')).toBe(true);
    expect(parseBool('false')).toBe(false);
  });

  it('parses tolerantly for forward compat', () => {
    expect(parseBool(' True ')).toBe(true);
    expect(parseBool('FALSE')).toBe(false);
  });

  it('throws on garbage', () => {
    expect(() => parseBool('yes')).toThrow();
    expect(() => parseBool('')).toThrow();
  });
});
