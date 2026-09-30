// @vitest-environment node
// The layout file (.bld-layout), shared with the desktop
// (references/LAYOUT-FILE.md, desktop src/import/LayoutFile.cpp).

import { describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import { buildZip, layoutsFromFiles, readZip } from '../bbmFiles';
import { buildLayoutFile, readLayoutFile } from '../layoutFile';
import CORNER_LOBBY from '../../../../packages/bbm/tests/fixtures/corner-lobby.bld-layout?inline';
import WEB_MADE from '../../../../packages/bbm/tests/fixtures/web-made.bld-layout?inline';
import TIGHT_CORNER from '../../../../packages/bbm/tests/fixtures/tight-corner.bbm?raw';
import GRAND_LOBBY from '../../../../packages/bbm/tests/fixtures/grand-lobby.bld-venue?raw';

const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const FIXTURES: Record<string, Uint8Array> = {
  'corner-lobby.bld-layout': bytesOf(CORNER_LOBBY),
  'web-made.bld-layout': bytesOf(WEB_MADE),
};
const fixture = (name: string) => FIXTURES[name]!;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const sidecarJson = (bg?: Record<string, unknown>) =>
  JSON.stringify({
    schemaVersion: 1,
    bbmHashSha256: 'abc',
    anchoredLabels: [{ id: 'L1', text: 'North end' }],
    modules: [],
    ...(bg ? { backgroundImage: bg } : {}),
  });

describe('layout file', () => {
  it('reads the desktop-made fixture', async () => {
    const l = await readLayoutFile(fixture('corner-lobby.bld-layout'));
    expect(l.warnings).toEqual([]);
    expect(l.bbm).toBe(TIGHT_CORNER);
    const sidecar = JSON.parse(l.sidecar!) as Record<string, unknown>;
    expect((sidecar.anchoredLabels as { text: string }[])[0]!.text).toBe('Grand Lobby — north end');
    expect((sidecar.modules as { name: string }[])[0]!.name).toBe('Corner');
    expect((sidecar.venue as { name: string }).name).toBe(
      (JSON.parse(GRAND_LOBBY) as { name: string }).name,
    );
    // The image comes out beside the sidecar, for the server to keep.
    expect(sidecar.backgroundImage).toEqual({ opacity: 0.3, rect: [-10, -20, 300, 200] });
    expect(l.background?.type).toBe('image/png');
    expect([...l.background!.data.subarray(0, 8)]).toEqual([...PNG.subarray(0, 8)]);
  });

  it('writes one file the desktop reads: layout, sidecar and image', async () => {
    const bytes = await buildLayoutFile({
      bbm: '<Map>' + '<Brick />'.repeat(100) + '</Map>',
      sidecar: sidecarJson({ url: '/api/layouts/1/background-image', path: 'C:/x.png', opacity: 0.4 }),
      background: { type: 'image/png', data: PNG },
    });
    const entries = await readZip(bytes);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'layout.bbm', 'background.png', 'sidecar.json']);
    expect(JSON.parse(dec.decode(entries[0]!.data))).toMatchObject({ format: 'bld-layout', version: 1 });
    // Methods: the manifest stored (first bytes say what the file is), the layout deflated.
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint16(8, true)).toBe(0);
    expect(dec.decode(bytes.subarray(30, 43))).toBe('manifest.json');
    const sidecar = JSON.parse(dec.decode(entries[3]!.data)) as Record<string, unknown>;
    expect(sidecar.bbmHashSha256).toBeUndefined();
    expect(sidecar.backgroundImage).toEqual({ opacity: 0.4, file: 'background.png' });
    expect(entries[2]!.data).toEqual(PNG);

    const back = await readLayoutFile(bytes);
    expect(back.bbm).toBe('<Map>' + '<Brick />'.repeat(100) + '</Map>');
    expect(back.background).toEqual({ type: 'image/png', data: PNG });
    expect(bytes.length).toBeLessThan(900 + PNG.length + 200); // deflated
  });

  it('leaves out the sidecar when the layout has none', async () => {
    const entries = await readZip(await buildLayoutFile({ bbm: '<Map/>', sidecar: null }));
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'layout.bbm']);
  });

  it('refuses what is not a layout file', async () => {
    await expect(readLayoutFile(enc.encode('<Map/>'))).rejects.toThrow('not a Brick Layout Designer layout file');
    const other = buildZip([
      { name: 'manifest.json', data: enc.encode('{"format":"something-else","version":1}') },
      { name: 'layout.bbm', data: enc.encode('<Map/>') },
    ]);
    await expect(readLayoutFile(other)).rejects.toThrow('not a Brick Layout Designer layout file');
    const empty = buildZip([{ name: 'manifest.json', data: enc.encode('{"format":"bld-layout","version":1}') }]);
    await expect(readLayoutFile(empty)).rejects.toThrow('no layout');
  });

  it('opens a newer version with a warning', async () => {
    const newer = buildZip([
      { name: 'manifest.json', data: enc.encode('{"format":"bld-layout","version":2}') },
      { name: 'layout.bbm', data: enc.encode('<Map/>') },
      { name: 'parts/new.xml', data: enc.encode('<part/>') },
    ]);
    const l = await readLayoutFile(newer);
    expect(l.bbm).toBe('<Map/>');
    expect(l.warnings).toHaveLength(1);
  });

  it('opens when dropped, with its image', async () => {
    const bytes = await buildLayoutFile({ bbm: '<L/>', sidecar: sidecarJson({ url: '/u', opacity: 0.5 }), background: { type: 'image/png', data: PNG } });
    const [l] = await layoutsFromFiles([new File([bytes as BlobPart], 'Show.bld-layout')]);
    expect(l).toMatchObject({ name: 'Show.bld-layout', bbm: '<L/>', background: { type: 'image/png', data: PNG } });
    expect(JSON.parse(l!.sidecar!).backgroundImage).toEqual({ opacity: 0.5 });
  });

  // packages/bbm/tests/fixtures/web-made.bld-layout, which the desktop reads
  // (its fixtures/layouts/): the desktop fixture opened as the web does and
  // downloaded again, by apps/web/scripts/make-web-made-layout.ts.
  it('reads the web-made fixture the desktop reads', async () => {
    const l = await readLayoutFile(fixture('web-made.bld-layout'));
    expect(l.warnings).toEqual([]);
    expect(readBbm(l.bbm).map.layers.length).toBeGreaterThan(0);
    const manifest = JSON.parse(dec.decode((await readZip(fixture('web-made.bld-layout')))[0]!.data)) as { generator: string };
    expect(manifest.generator).toBe('Brick Layout Designer (web)');
    expect(JSON.parse(l.sidecar!).backgroundImage).toEqual({ opacity: 0.3, rect: [-10, -20, 300, 200] });
    expect(l.background?.type).toBe('image/png');
  });
});
