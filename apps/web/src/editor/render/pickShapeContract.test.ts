// The web picks an imported part by its <PickShape>; the desktop by its
// sprite's mask. Both give the answer in fixtures/contracts/imported-part.json
// at each point (the desktop's side: tests/sync/ContractsTest.cpp).
import { describe, expect, it } from 'vitest';
import { parsePartXml } from '@cld/parts-catalog';
import { insidePickShape } from './pickShape';
import XML from '../../../../../fixtures/contracts/imported-part.xml?raw';
import JSON_TEXT from '../../../../../fixtures/contracts/imported-part.json?raw';


describe('PickShape contract', () => {
  it('hits and misses where the desktop does', () => {
    const xml = XML;
    const want = JSON.parse(JSON_TEXT) as { hits: { x: number; y: number; inside: boolean }[] };
    const rings = parsePartXml(xml, { partNumber: 'HARBOUR_YARD', colorCode: '', spritePath: '' }).pickShape;
    expect(rings).toBeDefined();
    expect(want.hits.length).toBeGreaterThanOrEqual(6);
    for (const h of want.hits) expect(insidePickShape(rings!, h.x, h.y), `${h.x},${h.y}`).toBe(h.inside);
  });
});
