// 4DBrix .ncp against vanilla BlueBrick (desktop LDrawMapTest.cpp
// FourDBrix* tests): fourdbrix.ncp is what vanilla wrote for
// fourdbrix.bbm, and fourdbrix.from-ncp.bbm what it read back from it.

import { existsSync } from 'node:fs';
import { writeBbm } from '@cld/bbm';
import { beforeAll, describe, expect, it } from 'vitest';
import { rebuildConnectivity } from '../connectivity.js';
import { scanCatalog } from '../scan.js';
import { readFourDBrixMap, writeFourDBrixMap } from './fourDBrix.js';
import { MapLibrary } from './library.js';
import { bricksOf, numericDiff, oracleMap, oracleText, PARTS, unmatched } from './oracleUtil.js';

// Everything but the file dates, which depend on when it was written.
const ncpLines = (text: string) =>
  text.split('\r\n').filter((l) => !l.includes('<created ') && !l.includes('<modified '));

describe.skipIf(!existsSync(PARTS))('4DBrix maps match vanilla BlueBrick', () => {
  let lib: MapLibrary;
  beforeAll(async () => {
    lib = new MapLibrary((await scanCatalog(PARTS)).catalog);
  }, 60_000);

  it('writes what vanilla wrote', () => {
    // Vanilla saved this map, links included; keep them (some partners are
    // BrickTracks parts only vanilla's installed library has).
    const out = writeFourDBrixMap(oracleMap('fourdbrix.bbm'), lib);
    expect(out.endsWith('</data>\r\n')).toBe(true);
    expect(numericDiff(ncpLines(out), ncpLines(oracleText('fourdbrix.ncp')))).toBe('');
  });

  it('reads what vanilla read', () => {
    const vanilla = oracleMap('fourdbrix.from-ncp.bbm');
    const ours = readFourDBrixMap(oracleText('fourdbrix.ncp'), lib);
    expect(ours.warnings).toEqual([]);
    expect(unmatched(bricksOf(ours.map), bricksOf(vanilla))).toBe('');
    expect(ours.map.layers.map((l) => l.type)).toEqual(vanilla.layers.map((l) => l.type));
    ours.map.layers.forEach((l, i) => {
      const v = vanilla.layers[i]!;
      if (l.type !== 'brick' || v.type !== 'brick') return; // grid names are a global counter
      expect(l.name).toBe(v.name);
      expect(l.groups.length, `layer ${i}`).toBe(v.groups.length);
    });
    expect(ours.map.selectedLayerIndex).toBe(3);
    expect(ours.map.event).toBe('Unknown Event');
  });

  it('keeps groups through a round trip', () => {
    const map = oracleMap('fourdbrix.bbm');
    rebuildConnectivity(map, lib.catalog);
    const back = readFourDBrixMap(writeFourDBrixMap(map, lib), lib);
    const mapped = (pn: string) => !!lib.meta(pn)?.fourDBrix;
    expect(unmatched(bricksOf(back.map, mapped), bricksOf(map, mapped), false)).toBe('');
    const grouped = back.map.layers.reduce((n, l) => n + (l.type === 'brick' ? l.groups.length : 0), 0);
    expect(grouped).toBeGreaterThan(0);
  });

  it('lists unmapped names once and escapes the project fields', () => {
    const map = oracleMap('fourdbrix.bbm');
    map.event = 'A & B "<x>"';
    map.date = { day: 3, month: 2, year: 2024 };
    const out = writeFourDBrixMap(map, lib, { created: new Date(2020, 0, 9, 8, 7, 6), now: new Date(2026, 8, 28, 13, 5, 0) });
    expect(out).toContain('<title value="A &amp; B &quot;&lt;x&gt;&quot;"/>');
    expect(out).toContain('<created value="9-Jan-2020, 08:07:06"/>');
    expect(out).toContain('<modified value="28-Sep-2026, 13:05:00"/>');
    expect(out).toContain('<description value="3-Feb-2024, 00:00:00"/>');
    expect(readFourDBrixMap(out, lib).map.event).toBe('A & B "<x>"');

    const bad = readFourDBrixMap(
      `<data><segment><index value="1"/><type value="NOPE"/></segment><segment><type value="NOPE"/></segment>
       <table><svgfile value="none.svg"/></table></data>`,
      lib,
    );
    // Segments are placed after everything else is read, as in BlueBrick.
    expect(bad.warnings).toEqual(['No part is mapped to these 4DBrix parts: none.svg, NOPE']);
  });

  it('reads numbers out of range as 0, so the map can be saved', () => {
    // A table's x overflows a float.
    const ncp = oracleText('fourdbrix.ncp').replace('<coordinates x ="2304" y="1536"/>', '<coordinates x ="1e39" y="1536"/>');
    expect(ncp).toContain('1e39');
    const r = readFourDBrixMap(ncp, lib);
    expect(() => writeBbm(r.map)).not.toThrow();
  });
});
