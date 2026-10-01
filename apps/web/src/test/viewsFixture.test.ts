// @vitest-environment node
// The shared saved-views fixture (packages/bbm/tests/fixtures/views.bld-layout,
// references/LAYOUT-FILE.md "Saved views"): a small layout with two views,
// one fitting the whole layout and one keeping an area of one sheet. The
// desktop reads the same file and must find the same views and areas.
//
// BLD_UPDATE_FIXTURES=1 writes the fixture again from the layout below.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readSidecar, writeSidecar, type SavedView } from '@cld/bbm';
import { readBbm } from '@cld/bbm';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import { buildLayoutFile, readLayoutFile } from '../layoutFile';
import { addAnchoredLabel, addLayer, ensureBrickLayer, placeBrick, renameLayer } from '../editor/mutations';
import { viewRegionStuds } from '../editor/savedViews';
import VIEWS from '../../../../packages/bbm/tests/fixtures/views.bld-layout?inline';

// Node's, without the web app taking in Node's types.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

export const FIXTURE_VIEWS: SavedView[] = [
  { id: 'view-whole', name: 'Whole layout', fit: true, rect: null, sheets: null, grid: true, labels: true },
  { id: 'view-station', name: 'Station', fit: false, rect: { x: 90, y: 40, w: 40, h: 30 }, sheets: ['sheet-town'], grid: false, labels: false },
];

/** Track at (0,0)-(32,8) and (32,0)-(64,8); the station at (100,50)-(120,60); a label at (70,-20). */
function buildFixtureDoc(): Y.Doc {
  const doc = new Y.Doc();
  const track = ensureBrickLayer(doc);
  renameLayer(doc, track, 'Track');
  const town = addLayer(doc, 'brick');
  renameLayer(doc, town, 'Town');
  placeBrick(doc, track, { partNumber: '3001.1', x: 0, y: 0, width: 32, height: 8 });
  placeBrick(doc, track, { partNumber: '3001.1', x: 32, y: 0, width: 32, height: 8 });
  placeBrick(doc, town, { partNumber: '3001.1', x: 100, y: 50, width: 20, height: 10 });
  addAnchoredLabel(doc, {
    id: 'label-1', text: 'North end', font: { family: 'Arial', size: 10, style: 'Regular' },
    color: { known: true, argb: -16777216, name: 'Black' }, kind: 0, targetId: '', offset: { x: 70, y: -20 }, rot: 0, minZoom: 0,
  });
  return doc;
}

describe('saved views fixture', () => {
  it.runIf(env.BLD_UPDATE_FIXTURES === '1')('writes the fixture', async () => {
    const doc = buildFixtureDoc();
    // Stable layer ids, so a view can name its sheet.
    const map = docToBbm(doc);
    map.layers[0]!.id = 'sheet-track';
    map.layers[1]!.id = 'sheet-town';
    const { writeBbm } = await import('@cld/bbm');
    const sidecar = { ...readSidecarFromDoc(doc)!, schemaVersion: 1, bbmHashSha256: '', views: FIXTURE_VIEWS };
    const bytes = await buildLayoutFile({ bbm: writeBbm(map), sidecar: writeSidecar(sidecar) });
    const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as { writeFileSync: (path: string, data: Uint8Array) => void };
    fs.writeFileSync(decodeURIComponent(new URL('../../../../packages/bbm/tests/fixtures/views.bld-layout', import.meta.url).pathname), bytes);
  });

  it('carries the two views in the layout file, and a fresh write keeps them', async () => {
    const file = await readLayoutFile(bytesOf(VIEWS));
    expect(file.warnings).toEqual([]);
    const sidecar = readSidecar(file.sidecar!);
    expect(sidecar.views).toEqual(FIXTURE_VIEWS);
    // Written again (as a download does) and read back: the same views.
    const again = await readLayoutFile(await buildLayoutFile({ bbm: file.bbm, sidecar: writeSidecar(sidecar) }));
    expect(readSidecar(again.sidecar!).views).toEqual(FIXTURE_VIEWS);
  });

  it('works out the same areas the desktop must: fit = sheets + label + 4 studs, the area as saved', async () => {
    const file = await readLayoutFile(bytesOf(VIEWS));
    const { map } = readBbm(file.bbm);
    const sidecar = readSidecar(file.sidecar!);
    expect(map.layers.map((l) => [l.id, l.name])).toEqual([
      ['sheet-track', 'Track'],
      ['sheet-town', 'Town'],
    ]);
    expect(viewRegionStuds(FIXTURE_VIEWS[0]!, map, sidecar)).toEqual({ x: -4, y: -24, width: 128, height: 88 });
    expect(viewRegionStuds(FIXTURE_VIEWS[1]!, map, sidecar)).toEqual({ x: 90, y: 40, width: 40, height: 30 });
    // The area view, fitted instead, covers only its one sheet (no labels).
    expect(viewRegionStuds({ ...FIXTURE_VIEWS[1]!, fit: true }, map, sidecar)).toEqual({ x: 96, y: 46, width: 28, height: 18 });
  });
});
