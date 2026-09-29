import { describe, expect, it } from 'vitest';
import { fontStack } from '../render/fontStack';

describe('fontStack', () => {
  it('ends a stored family in sans-serif faces, not the browser default serif', () => {
    expect(fontStack('Tahoma')).toBe('"Tahoma", Arial, Helvetica, "Liberation Sans", sans-serif');
    expect(fontStack('Microsoft Sans Serif')).toMatch(/^"Microsoft Sans Serif", .*sans-serif$/);
  });

  it('Arial or no family is the plain sans stack', () => {
    expect(fontStack('Arial')).toBe('Arial, Helvetica, "Liberation Sans", sans-serif');
    expect(fontStack('')).toBe('Arial, Helvetica, "Liberation Sans", sans-serif');
    expect(fontStack(undefined)).toBe('Arial, Helvetica, "Liberation Sans", sans-serif');
  });

  it('strips quotes that would break the CSS font shorthand', () => {
    expect(fontStack('Evil"Font')).toBe('"EvilFont", Arial, Helvetica, "Liberation Sans", sans-serif');
  });
});
