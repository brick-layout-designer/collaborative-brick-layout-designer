// Anchored-label colours: rendering from argb like desktop decodeColor,
// and the edit dialog keeping an unchanged colour spec.

import { describe, expect, it } from 'vitest';
import { labelColorHex, labelColorToSave } from '../labelColor';

const BLACK_KNOWN = { known: true, argb: 0xff000000, name: 'Black' };

describe('labelColorHex', () => {
  it('renders from argb, even for a known colour', () => {
    expect(labelColorHex({ known: false, argb: 0xff12ab34, name: '' })).toBe('12AB34');
    // Desktop writes argb for known colours too; argb wins over the name.
    expect(labelColorHex({ known: true, argb: 0xffff0000, name: 'Blue' })).toBe('FF0000');
    expect(labelColorHex(BLACK_KNOWN)).toBe('000000');
  });

  it('falls back to the name only when argb is 0', () => {
    expect(labelColorHex({ known: true, argb: 0, name: 'Orange' })).toBe('FFA500');
    expect(labelColorHex({ known: true, argb: 0, name: 'blue' })).toBe('0000FF');
    expect(labelColorHex({ known: true, argb: 0, name: 'NoSuchColour' })).toBe('000000');
  });

  it('pads and drops the alpha byte', () => {
    expect(labelColorHex({ known: false, argb: 0x80000102, name: '' })).toBe('000102');
  });
});

describe('labelColorToSave', () => {
  it('keeps an unchanged known colour as is (no FF000000 rewrite)', () => {
    const red = { known: true, argb: 0xffff0000, name: 'Red' };
    expect(labelColorToSave(red, false, 'FFFF0000')).toBe(red);
    expect(labelColorToSave(BLACK_KNOWN, false, 'FF000000')).toEqual(BLACK_KNOWN);
  });

  it('keeps an unchanged ARGB colour as is', () => {
    const c = { known: false, argb: 0xff336699, name: '' };
    expect(labelColorToSave(c, false, 'FF336699')).toBe(c);
  });

  it('writes the picked colour as plain ARGB once the user changes it', () => {
    expect(labelColorToSave(BLACK_KNOWN, true, 'FF00FF00')).toEqual({ known: false, argb: 0xff00ff00, name: '' });
  });

  it('a new label (no initial colour) saves the picked colour', () => {
    expect(labelColorToSave(undefined, false, 'FF000000')).toEqual({ known: false, argb: 0xff000000, name: '' });
  });
});
