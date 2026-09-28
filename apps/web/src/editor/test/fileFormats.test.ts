// Desktop-compatible file formats and labels: budget (.bbb), venue
// (.bld-venue), ruler distance labels and module label sizing.

import { describe, expect, it } from 'vitest';
import type { Venue } from '@cld/bbm';
import { parseBbb, writeBbb } from '../budgetFile';
// Saved by vanilla BlueBrick 1.9.2 (desktop fixtures/bluebrick-oracle).
import BUDGET from '../../../../../packages/bbm/tests/fixtures/oracle/budget.bbb?raw';
import BUDGET_EMPTY from '../../../../../packages/bbm/tests/fixtures/oracle/budget-empty.bbb?raw';
import { parseVenueFile, writeVenueFile } from '../venueFile';
import { formatDistance } from '../render/RulerLayer';
import { moduleLabelFontPx } from '../render/ModuleOverlay';

describe('.bbb budget files (vanilla BlueBrick format, Budget.cpp)', () => {
  it('reads vanilla files in file order, ids as written', () => {
    expect(parseBbb(BUDGET)).toEqual([
      { part: '2865.8', limit: 12 },
      { part: '3811.1', limit: 0 },
      { part: 'TS_OLDNAME_TEST', limit: 3 },
    ]);
    expect(parseBbb(BUDGET_EMPTY)).toEqual([]);
  });

  it('writes vanilla files back byte for byte (CRLF, utf-8, <PartList />, no trailing newline)', () => {
    expect(writeBbb(parseBbb(BUDGET))).toBe(BUDGET);
    expect(writeBbb([])).toBe(BUDGET_EMPTY);
  });

  it('escapes ids, keeps order and drops unlimited entries on write', () => {
    expect(writeBbb([{ part: 'b&<"x">', limit: 3 }, { part: 'a', limit: -1 }, { part: 'B', limit: 0 }])).toBe(
      '<?xml version="1.0" encoding="utf-8"?>\r\n<Budget>\r\n  <Version>1</Version>\r\n  <PartList>\r\n' +
        '    <Part id="b&amp;&lt;&quot;x&quot;&gt;">3</Part>\r\n    <Part id="B">0</Part>\r\n  </PartList>\r\n</Budget>',
    );
  });

  it('keeps the first of ids that differ only in case, like BlueBrick', () => {
    expect(parseBbb('<Budget><PartList><Part id="ts_x">2</Part><Part id="TS_X">5</Part></PartList></Budget>')).toEqual([
      { part: 'ts_x', limit: 2 },
    ]);
  });

  it('rejects a file with a non-integer value or a Part without an id', () => {
    expect(() => parseBbb('<Budget><PartList><Part id="a">x</Part></PartList></Budget>')).toThrow();
    expect(() => parseBbb('<Budget><PartList><Part>3</Part></PartList></Budget>')).toThrow();
    expect(() => parseBbb('<NotABudget/>')).toThrow();
  });

  it('still opens files saved by earlier web builds', () => {
    const xml =
      '<Budget><BudgetEntry><PartNumber>p1</PartNumber><Limit>-1</Limit></BudgetEntry>' +
      '<BudgetEntry><PartNumber>p2</PartNumber></BudgetEntry>' +
      '<BudgetEntry><PartNumber>p3</PartNumber><Limit>7</Limit></BudgetEntry></Budget>';
    expect(parseBbb(xml)).toEqual([{ part: 'p1', limit: -1 }, { part: 'p3', limit: 7 }]);
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
