// Import -> live doc -> export -> import, with no drift, for every .bbm the
// repo carries and for odd layouts (audit 2026-10-20, track B): empty,
// only text, only rulers, only areas, unicode everywhere.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm, writeBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';
import { bbmToDoc, docToBbm } from './projection.js';
import { createDefaultLayoutDoc } from './index.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../bbm/tests/fixtures');

/** Through a live doc and its stored bytes, as the server keeps it. */
function throughDoc(map: BbmMap): BbmMap {
  const a = new Y.Doc();
  bbmToDoc(map, a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  return docToBbm(b);
}

const files = [
  ...['tight-corner.bbm', 'fordyce-2026.bbm'].map((f) => resolve(FIXTURES, f)),
  ...readdirSync(resolve(FIXTURES, 'oracle'))
    .filter((f) => f.endsWith('.bbm'))
    .map((f) => resolve(FIXTURES, 'oracle', f)),
];

describe('every .bbm fixture survives import -> doc -> export byte for byte', () => {
  for (const file of files) {
    it(file.slice(FIXTURES.length + 1), () => {
      const xml = readFileSync(file, 'utf8');
      const parsed = readBbm(xml);
      expect(parsed.warnings).toEqual([]);
      const out = writeBbm(throughDoc(parsed.map), { recomputeNbItems: false });
      expect(out).toBe(xml);
      // And a second trip changes nothing.
      expect(writeBbm(throughDoc(readBbm(out).map), { recomputeNbItems: false })).toBe(out);
    });
  }
});

function baseMap(): BbmMap {
  return docToBbm(createDefaultLayoutDoc());
}

function roundTrip(map: BbmMap): BbmMap {
  const xml = writeBbm(throughDoc(map));
  const back = readBbm(xml);
  expect(back.warnings).toEqual([]);
  // A second trip is stable.
  expect(writeBbm(throughDoc(back.map))).toBe(xml);
  return back.map;
}

const hull = { isVisible: false, hullColor: { kind: 'known' as const, name: 'Black' }, hullThickness: 1 };
const font = { family: 'Arial', size: 12, style: 'Regular' };
const UNICODE = 'Zürich 駅 🚂 «quotes» & <tags> "dq" \'sq\'  nbsp';

describe('odd layouts round-trip', () => {
  it('a layout with no layers at all', () => {
    const map = { ...baseMap(), layers: [], selectedLayerIndex: -1 };
    const back = roundTrip(map);
    expect(back.layers).toEqual([]);
  });

  it('a layout with only an empty brick sheet', () => {
    const map = baseMap();
    const back = roundTrip({ ...map, layers: map.layers.filter((l) => l.type === 'brick'), selectedLayerIndex: 0 });
    expect(back.layers).toHaveLength(1);
    expect(back.layers[0]!.type).toBe('brick');
  });

  it('a layout with only text, in unicode', () => {
    const map: BbmMap = {
      ...baseMap(),
      author: UNICODE,
      lug: UNICODE,
      event: UNICODE,
      comment: `${UNICODE}\r\nsecond line`,
      selectedLayerIndex: 0,
      layers: [
        {
          id: 't1',
          type: 'text',
          name: UNICODE,
          visible: true,
          transparency: 100,
          hullProperties: hull,
          textCells: [
            {
              displayArea: { x: 1, y: 2, width: 30, height: 10 },
              myGroup: '',
              orientation: 0,
              text: UNICODE,
              fontColor: { kind: 'known', name: 'Black' },
              font,
              textAlignment: 'Center',
            },
          ],
          groups: [],
        } as unknown as BbmMap['layers'][number],
      ],
    };
    const back = roundTrip(map);
    expect(back.author).toBe(UNICODE);
    // XML reads every line break as LF (vanilla and the desktop too); the
    // writer puts CRLF back.
    expect(back.comment).toBe(`${UNICODE}\nsecond line`);
    expect(back.layers[0]!.name).toBe(UNICODE);
    const t = back.layers[0]!;
    if (t.type !== 'text') throw new Error('not text');
    expect(t.textCells[0]!.text).toBe(UNICODE);
  });

  it('a pasted control character is left out of the file, which stays well-formed XML', () => {
    const map: BbmMap = { ...baseMap(), author: 'Ann\u0001e', comment: 'tab\there\u0000' };
    const xml = writeBbm(throughDoc(map));
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false);
    const back = readBbm(xml).map;
    expect(back.author).toBe('Anne');
    expect(back.comment).toBe('tab\there');
  });

  it('a layout with only an area sheet', () => {
    const map: BbmMap = {
      ...baseMap(),
      selectedLayerIndex: 0,
      layers: [
        {
          id: 'a1',
          type: 'area',
          name: 'Areas',
          visible: true,
          transparency: 50,
          hullProperties: hull,
          areaCellSize: 32,
          areas: [
            { x: 0, y: 0, color: 'FFFF0000' },
            { x: -3, y: 7, color: '8000FF00' },
          ],
        } as unknown as BbmMap['layers'][number],
      ],
    };
    const back = roundTrip(map);
    const a = back.layers[0]!;
    if (a.type !== 'area') throw new Error('not area');
    expect(a.areas).toHaveLength(2);
  });
});
