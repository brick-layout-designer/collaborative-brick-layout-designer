// Targeted desktop-parity checks for fields the fixture round-trip only
// exercises with default values. Reference: brick-layout-designer
// src/saveload/LayerIO.cpp + XmlPrimitives.cpp.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LayerGrid, LayerRuler } from '@cld/model';
import { readBbm } from './Reader.js';
import { writeBbm } from './Writer.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');
const tightCorner = readFileSync(resolve(FIXTURES, 'tight-corner.bbm'), 'utf8');
const fordyce = readFileSync(resolve(FIXTURES, 'fordyce-2026.bbm'), 'utf8');

const CORNER_BLOCK =
  '<CellIndexCorner>\r\n        <X>0</X>\r\n        <Y>0</Y>\r\n      </CellIndexCorner>';

function grid(xml: string): LayerGrid {
  const layer = readBbm(xml).map.layers.find((l) => l.type === 'grid');
  if (!layer || layer.type !== 'grid') throw new Error('no grid layer');
  return layer;
}

function ruler(xml: string): LayerRuler {
  const layer = readBbm(xml).map.layers.find((l) => l.type === 'ruler');
  if (!layer || layer.type !== 'ruler') throw new Error('no ruler layer');
  return layer;
}

describe('grid <CellIndexCorner> is an integer point', () => {
  it('fixture corpus holds <X>/<Y> children', () => {
    expect(tightCorner).toContain(CORNER_BLOCK);
    expect(grid(tightCorner).cellIndexCorner).toEqual({ x: 0, y: 0 });
  });

  it('reads and writes non-zero coordinates', () => {
    const xml = tightCorner.replace(
      CORNER_BLOCK,
      '<CellIndexCorner>\r\n        <X>3</X>\r\n        <Y>-2</Y>\r\n      </CellIndexCorner>',
    );
    const { map } = readBbm(xml);
    expect(grid(xml).cellIndexCorner).toEqual({ x: 3, y: -2 });
    expect(writeBbm(map)).toBe(xml);
  });

  it('defaults missing / self-closed corner children to 0 (xml::readPoint)', () => {
    expect(grid(tightCorner.replace(CORNER_BLOCK, '<CellIndexCorner />')).cellIndexCorner).toEqual({
      x: 0,
      y: 0,
    });
    const onlyY = tightCorner.replace(
      CORNER_BLOCK,
      '<CellIndexCorner>\r\n        <Y>7</Y>\r\n      </CellIndexCorner>',
    );
    expect(grid(onlyY).cellIndexCorner).toEqual({ x: 0, y: 7 });
  });
});

describe('ruler <GuidelineDashPattern>', () => {
  it('reads <value> children (desktop / BlueBrick format)', () => {
    for (const item of ruler(fordyce).rulerItems) {
      expect(item.guidelineDashPattern).toEqual([2, 4]);
    }
  });

  it('reads legacy <double> children written by earlier web builds', () => {
    const legacy = fordyce.replaceAll(/<(\/?)value>/g, '<$1double>');
    for (const item of ruler(legacy).rulerItems) {
      expect(item.guidelineDashPattern).toEqual([2, 4]);
    }
    // ...and re-saves in the desktop format.
    expect(writeBbm(readBbm(legacy).map)).toBe(fordyce);
  });

  it('reads a single-entry pattern', () => {
    const one = fordyce.replace(
      /<GuidelineDashPattern>\r\n\s*<value>2<\/value>\r\n\s*<value>4<\/value>/,
      '<GuidelineDashPattern>\r\n            <value>1.5</value>',
    );
    expect(ruler(one).rulerItems[0]!.guidelineDashPattern).toEqual([1.5]);
  });

  it('writes <value>, never <double>', () => {
    const out = writeBbm(readBbm(fordyce).map);
    expect(out).toContain('<value>2</value>');
    expect(out).not.toContain('<double>');
  });
});

describe('nbItems recompute matches BlueBrick', () => {
  it('counts each grid layer as one item', () => {
    const { map } = readBbm(tightCorner);
    // tight-corner: 304 bricks + 13 text cells + 1 grid layer.
    expect(map.nbItems).toBe(318);
    const withoutGrid = { ...map, layers: map.layers.filter((l) => l.type !== 'grid') };
    expect(writeBbm(withoutGrid)).toContain('<nbItems>317</nbItems>');
  });

  it('reflects edits instead of echoing a stale value', () => {
    const { map } = readBbm(tightCorner);
    const layers = map.layers.map((l) =>
      l.type === 'brick' && l.bricks.length > 0 ? { ...l, bricks: l.bricks.slice(1) } : l,
    );
    const out = writeBbm({ ...map, layers });
    const removed = map.layers.filter((l) => l.type === 'brick' && l.bricks.length > 0).length;
    expect(out).toContain(`<nbItems>${318 - removed}</nbItems>`);
  });
});
