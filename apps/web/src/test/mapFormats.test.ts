// Opening and saving LDraw / TrackDesigner / 4DBrix maps in the browser:
// a layout survives the trip through each format, using the parts'
// remaps from the catalog wire. (The formats themselves are tested
// against vanilla BlueBrick in @cld/parts-catalog.)

import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm/browser';
import type { BbmMap } from '@cld/model';
import type { PartWire } from '../api';
import { LAYOUT_ACCEPT, mapDownload, mapFileToBbm, mapFormatOf, MAP_FORMATS } from '../mapFormats';

// A 4 x 2 stud straight track with a connection at each end.
const track: PartWire = {
  key: 'trk.1',
  partNumber: 'TRK',
  colorCode: '1',
  kind: 'leaf',
  description: 'Track',
  sortingKey: '',
  spritePath: 'Track/TRK.1.gif',
  pxPerStud: 8,
  category: 'Track',
  connections: [
    { type: '1', x: -2, y: 0, angle: 180, electricPlug: 0 },
    { type: '1', x: 2, y: 0, angle: 0, electricPlug: 0 },
  ],
  subparts: [],
  hullPts: [],
  source: 'bundled',
  customPartId: null,
  spriteSize: { w: 32, h: 16 },
  ldraw: { angle: 0, translation: { x: 0, y: 0 }, preferredHeight: 0, sleeper: '', alias: '' },
  trackDesigner: { defaultId: 77, registryIds: {}, flags: 0, hasSeveralPorts: false, ports: [{ bbConnectionIndex: 0, type: 0, angleDifference: 0 }] },
  fourDBrix: { type: 'segment', partName: 'TS_TRK', orientationDifference: 0, originConnection: 0 },
};

function layout(): BbmMap {
  const brick = (id: string, x: number, orientation: number) => ({
    id,
    displayArea: { x, y: 10, width: orientation ? 2 : 4, height: orientation ? 4 : 2 },
    myGroup: '',
    partNumber: 'TRK.1',
    orientation,
    activeConnectionPointIndex: 0,
    altitude: 0,
    connexions: [
      { id: `${id}a`, linkedTo: '' },
      { id: `${id}b`, linkedTo: '' },
    ],
  });
  return {
    version: 9,
    nbItems: 2,
    backgroundColor: { kind: 'known', name: 'White' },
    author: 'Me',
    lug: '',
    event: 'Show',
    date: { day: 1, month: 2, year: 2026 },
    comment: '',
    exportInfo: { exportPath: '', exportFileType: 1, exportArea: { x: 0, y: 0, width: 0, height: 0 }, exportScale: 0, exportWatermark: false, exportElectricCircuit: false, exportConnectionPoints: false },
    selectedLayerIndex: 0,
    layers: [
      {
        type: 'brick',
        id: '1',
        name: 'Rails',
        visible: true,
        transparency: 100,
        hullProperties: { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 },
        displayBrickElevation: false,
        bricks: [brick('10', 0, 0), brick('20', 20, 90)],
        groups: [],
      },
    ],
  };
}

const areas = (map: BbmMap) =>
  map.layers.flatMap((l) => (l.type === 'brick' ? l.bricks.map((b) => [b.partNumber, b.orientation, b.displayArea]) : [])).sort();

describe('map formats in the browser', () => {
  for (const { format } of MAP_FORMATS) {
    it(`keeps the bricks through .${format}`, async () => {
      const out = await mapDownload(layout(), [track], format, 'My: layout');
      expect(out.filename).toBe(`My_ layout.${format}`);
      const back = await mapFileToBbm(out.filename, out.data, [track]);
      expect(back.warnings).toEqual([]);
      const map = readBbm(back.bbm).map;
      const got = areas(map).map(([pn, o, a]) => [pn, o, a && Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))]);
      expect(got).toEqual(areas(layout()));
    });
  }

  it('reports parts no remap covers', async () => {
    const ncp = '<data><table><coordinates x="0" y="0"/><svgfile value="none.svg"/></table></data>';
    const r = await mapFileToBbm('x.ncp', new TextEncoder().encode(ncp), [track]);
    expect(r.warnings).toEqual(['No part is mapped to these 4DBrix parts: none.svg']);
    await expect(mapFileToBbm('x.txt', new Uint8Array(), [track])).rejects.toThrow('not an LDraw');
  });

  it('knows its file names', () => {
    expect(mapFormatOf('a.MPD')).toBe('mpd');
    expect(mapFormatOf('a.bbm')).toBeNull();
    expect(LAYOUT_ACCEPT.split(',')).toEqual(['.bld-layout', '.bbm', '.ldr', '.mpd', '.tdl', '.ncp']);
  });
});
