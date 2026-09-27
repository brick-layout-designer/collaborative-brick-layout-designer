// Desktop-compatible file formats and labels: budget (.bbb), venue
// (.bld-venue), ruler distance labels and module label sizing.

import { describe, expect, it } from 'vitest';
import type { Venue } from '@cld/bbm';
import { parseBbb, writeBbb } from '../budgetFile';
import { parseVenueFile, writeVenueFile } from '../venueFile';
import { formatDistance } from '../render/RulerLayer';
import { moduleLabelFontPx } from '../render/ModuleOverlay';

describe('.bbb budget files', () => {
  it('escapes XML, drops unlimited entries and sorts by code unit', () => {
    const xml = writeBbb([
      { part: 'b&<x>', limit: 3 },
      { part: 'a', limit: -1 },
      { part: 'B', limit: 0 },
    ]);
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Budget>\n  <Version>1</Version>\n' +
        '  <BudgetEntry>\n    <PartNumber>B</PartNumber>\n    <Limit>0</Limit>\n  </BudgetEntry>\n' +
        '  <BudgetEntry>\n    <PartNumber>b&amp;&lt;x&gt;</PartNumber>\n    <Limit>3</Limit>\n  </BudgetEntry>\n' +
        '</Budget>\n',
    );
    expect(parseBbb(xml)).toEqual([{ part: 'B', limit: 0 }, { part: 'b&<x>', limit: 3 }]);
  });

  it('ignores negative and missing limits when reading, like desktop', () => {
    const xml =
      '<Budget><BudgetEntry><PartNumber>p1</PartNumber><Limit>-1</Limit></BudgetEntry>' +
      '<BudgetEntry><PartNumber>p2</PartNumber></BudgetEntry>' +
      '<BudgetEntry><PartNumber>p3</PartNumber><Limit>7</Limit></BudgetEntry></Budget>';
    expect(parseBbb(xml)).toEqual([{ part: 'p3', limit: 7 }]);
  });
});

describe('venue files', () => {
  const venue: Venue = {
    name: 'Hall', enabled: true, minWalkwayStuds: 12,
    bounds: { x: 1, y: 2, w: 300, h: 200 },
    edges: [{ kind: 1, doorWidthStuds: 40, label: 'door', poly: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
    obstacles: [{ label: 'pillar', poly: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }] }],
  };

  it('writes the desktop bld-venue/1 schema and reads it back', () => {
    const text = writeVenueFile(venue);
    expect(JSON.parse(text).schema).toBe('bld-venue/1');
    expect(parseVenueFile(text)).toEqual(venue);
  });

  it('reads legacy web .cld-venue files (no schema) and defaults missing fields', () => {
    const v = parseVenueFile(JSON.stringify({ edges: [{ poly: [{ x: 1, y: 'bad' }] }] }));
    expect(v.enabled).toBe(true);
    expect(v.edges[0]).toEqual({ kind: 0, doorWidthStuds: 0, label: '', poly: [{ x: 1, y: 0 }] });
    expect(v.obstacles).toEqual([]);
  });

  it('rejects non-JSON, foreign schemas and empty objects', () => {
    expect(() => parseVenueFile('<xml/>')).toThrow(/JSON/);
    expect(() => parseVenueFile(JSON.stringify({ schema: 'other/1', edges: [] }))).toThrow(/schema/);
    expect(() => parseVenueFile('{}')).toThrow(/no venue/);
  });
});

describe('ruler distance labels (desktop formatDistance)', () => {
  it.each([
    [0, 32, '32.00 studs'],
    [1, 32, '640 LDU'],
    [2, 32, '2.00 tracks'],
    [3, 48, '0.50 mod'],
    [4, 100, '0.800 m'],
    [5, 100, '2.62 ft'],
  ])('unit %i, %f studs → %s', (unit, studs, label) => {
    expect(formatDistance(studs, unit)).toBe(label);
  });
});

describe('moduleLabelFontPx', () => {
  it('is percent of the long axis, clamped to 16..400 px', () => {
    expect(moduleLabelFontPx(400, 100, 35)).toBe(140);
    expect(moduleLabelFontPx(100, 400, 35)).toBe(140);
    expect(moduleLabelFontPx(20, 10, 35)).toBe(16);
    expect(moduleLabelFontPx(4000, 10, 100)).toBe(400);
  });
});
