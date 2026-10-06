// Desktop-compatible file formats and labels: budget (.bbb), venue
// (.bld-venue), ruler distance labels and module label sizing.

import { describe, expect, it } from 'vitest';
import type { Venue } from '@cld/bbm';
import { mergeBudgets, parseBbb, writeBbb } from '../budgetFile';
// Saved by vanilla BlueBrick 1.9.2 (desktop fixtures/bluebrick-oracle).
import BUDGET from '../../../../../packages/bbm/tests/fixtures/oracle/budget.bbb?raw';
import BUDGET_EMPTY from '../../../../../packages/bbm/tests/fixtures/oracle/budget-empty.bbb?raw';
import GRAND_LOBBY from '../../../../../packages/bbm/tests/fixtures/grand-lobby.bld-venue?raw';
import { parseVenueFile, writeVenueFile } from '../venueFile';
import { formatDistance } from '../render/RulerLayer';
import { fitModuleName, moduleLabelFontPx } from '../render/ModuleOverlay';

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

  it('Import and Merge adds limits, keeps the current spelling and moves merged parts to the end', () => {
    const merged = mergeBudgets(
      [{ part: '2865.8', limit: 12 }, { part: 'TS_X', limit: 1 }, { part: '3001.1', limit: 4 }],
      [{ part: 'ts_x', limit: 2 }, { part: '9999.1', limit: 5 }],
    );
    expect(merged).toEqual([
      { part: '2865.8', limit: 12 },
      { part: '3001.1', limit: 4 },
      { part: 'TS_X', limit: 3 },
      { part: '9999.1', limit: 5 },
    ]);
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

  it('round-trips the shared Grand Lobby fixture exactly (the desktop checks the same file)', () => {
    const v = parseVenueFile(GRAND_LOBBY);
    expect(v.power?.filter((p) => p.kind === 'floor')).toHaveLength(3);
    expect(v.obstacles.find((o) => o.kind === 'stairs')?.upDegrees).toBe(270);
    expect(v.edges.filter((e) => e.estimated)).toHaveLength(3);
    expect(v.dimensions?.some((d) => d.estimated)).toBe(true);
    expect(v.notes?.map((n) => n.text)).toContain('Concessions entrance is on the floor above');
    expect(JSON.parse(writeVenueFile(v))).toEqual(JSON.parse(GRAND_LOBBY));
  });

  it('keeps fields it does not know, at every level, and drops unset optional ones', () => {
    const newer = {
      schema: 'bld-venue/1',
      ...venue,
      floorColor: '#ccc',
      edges: [{ ...venue.edges[0], material: 'glass', estimated: false }],
      obstacles: [{ ...venue.obstacles[0], kind: 'fountain', heightStuds: 40 }],
      power: [{ x: 1, y: 2, kind: 'floor', label: '', amps: 0, phase: 3 }],
      notes: [{ x: 3, y: 4, text: 'n', estimated: true, author: 'me' }],
      dimensions: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, style: 'arrow' }],
    };
    const out = JSON.parse(writeVenueFile(parseVenueFile(JSON.stringify(newer))));
    expect(out.floorColor).toBe('#ccc');
    expect(out.edges[0]).toEqual({ ...venue.edges[0], material: 'glass' });
    // An unknown kind reads as "other" but its extra fields stay.
    expect(out.obstacles[0]).toEqual({ ...venue.obstacles[0], heightStuds: 40 });
    expect(out.power).toEqual([{ x: 1, y: 2, kind: 'floor', phase: 3 }]);
    expect(out.notes).toEqual([{ x: 3, y: 4, text: 'n', estimated: true, author: 'me' }]);
    expect(out.dimensions).toEqual([{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, style: 'arrow' }]);
    // A venue with none of the new parts writes none of them.
    expect(Object.keys(JSON.parse(writeVenueFile(venue)))).toEqual([
      'schema', 'name', 'enabled', 'minWalkwayStuds', 'bounds', 'edges', 'obstacles',
    ]);
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
  it('is percent of the long axis, at most half the short axis, clamped to 16..400 px', () => {
    expect(moduleLabelFontPx(400, 300, 35)).toBe(140);
    expect(moduleLabelFontPx(300, 400, 35)).toBe(140);
    expect(moduleLabelFontPx(20, 10, 35)).toBe(16);
    expect(moduleLabelFontPx(4000, 1000, 100)).toBe(400);
  });

  it('is never taller than half a long, thin module', () => {
    expect(moduleLabelFontPx(400, 100, 35)).toBe(50);
    expect(moduleLabelFontPx(100, 400, 35)).toBe(50);
    expect(moduleLabelFontPx(384, 48, 35)).toBe(24);
    expect(moduleLabelFontPx(4000, 10, 100)).toBe(16);
  });
});

describe('fitModuleName', () => {
  // A stand-in for the real measurement: each character is half the font size wide.
  const half = (t: string) => (fontPx: number) => t.length * fontPx * 0.5;

  it('keeps the size when the whole name fits the side', () => {
    expect(fitModuleName('0123456789', half, 100, 600)).toEqual({ fontPx: 100, lines: ['0123456789'], truncated: false });
  });

  it('wraps to a second line before it shrinks', () => {
    // 'North Yard' is 500 px at 100 px; each word fits 300 px.
    expect(fitModuleName('North Yard', half, 100, 300)).toEqual({ fontPx: 100, lines: ['North', 'Yard'], truncated: false });
  });

  it('then shrinks the font, never under 16 px', () => {
    const r = fitModuleName('Straightaway', half, 100, 300);
    expect(r).toEqual({ fontPx: 50, lines: ['Straightaway'], truncated: false });
    expect(fitModuleName('ABCDEFGHIJKLMNOPQRSTUVWXYZ', half, 20, 50).fontPx).toBe(16);
  });

  it('checks the shrunk size really fits when widths are not in proportion to the size', () => {
    // A fixed 30 px on top of each line: the proportional guess (74 px) is too big.
    const padded = (t: string) => (fontPx: number) => t.length * fontPx * 0.5 + 30;
    const r = fitModuleName('Straightaway', padded, 100, 470);
    expect(r.fontPx).toBe(73);
    expect(padded('Straightaway')(73)).toBeLessThanOrEqual(470);
    const big = fitModuleName('Straightaway', padded, 100, 400);
    expect(padded('Straightaway')(big.fontPx)).toBeLessThanOrEqual(400);
    expect(padded('Straightaway')(big.fontPx + 1)).toBeGreaterThan(400);
  });

  it('cuts it short with an ellipsis only as a last resort', () => {
    const r = fitModuleName('ABCDEFGHIJKLMNOPQRSTUVWXYZ', half, 20, 50);
    expect(r.truncated).toBe(true);
    expect(r.lines).toEqual(['ABCDE…']);
    expect(half(r.lines[0]!)(16)).toBeLessThanOrEqual(50);
  });
});


