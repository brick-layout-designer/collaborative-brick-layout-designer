// Each module's default colour: the same from its id every time, different
// from its neighbours', and readable: light inside the name's dark outline
// and apart from the map's default blue (light and dark themes draw the
// map in the layout's own colour, so the same rules hold in both).

import { describe, expect, it } from 'vitest';
import { MODULE_PALETTE, moduleColours, moduleLook } from './moduleLabels';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
/** BlueBrick's default map colour (cornflower blue). */
const MAP_BLUE = '#6495ED';

describe('module default colours', () => {
  it('are readable: 10:1 inside the dark outline, apart from the map blue, distinct hues', () => {
    for (const c of MODULE_PALETTE) {
      expect(contrast(c, '#000000')).toBeGreaterThanOrEqual(10);
      expect(contrast(c, MAP_BLUE)).toBeGreaterThanOrEqual(1.4);
      expect(hueGap(hue(c), hue(MAP_BLUE))).toBeGreaterThanOrEqual(30);
    }
    for (const [i, a] of MODULE_PALETTE.entries())
      for (const b of MODULE_PALETTE.slice(i + 1)) expect(hueGap(hue(a), hue(b))).toBeGreaterThanOrEqual(15);
  });

  it('come from the id, the same every time and in any order of reading', () => {
    const mods = [{ id: 'x1', box: null }, { id: 'x2', box: null }];
    expect(moduleColours(mods)).toEqual(moduleColours(mods));
    expect(moduleColours([mods[1]!]).get('x2')).toBe(moduleColours(mods).get('x2'));
  });

  it('differ between neighbours, even when their ids land on the same colour', () => {
    // Twelve modules in a row: each one's neighbours have other colours.
    const row = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, box: { x: i * 96, y: 0, w: 96, h: 96 } }));
    const got = moduleColours(row);
    for (let i = 1; i < row.length; i++) expect(got.get(`m${i}`)).not.toBe(got.get(`m${i - 1}`));
  });

  it('give way to a chosen colour', () => {
    expect(moduleLook({ outlineColor: '#ff0000' }, '#FFE066').frameStroke).toBe('rgba(255,0,0,0.8)');
    expect(moduleLook({}, '#FFE066')).toMatchObject({ frameStroke: 'rgba(255,224,102,0.8)', nameFill: 'rgba(255,224,102,0.9)' });
  });
});
