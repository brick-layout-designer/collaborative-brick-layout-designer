// @vitest-environment node
// A layout file's `source`: the server layout it was saved from. Written
// only for server layouts, kept with the manifest's unknown fields across a
// re-save, and ignored by readers that don't know it. The two fixtures are
// shared with the desktop (its fixtures/layouts/): each app reads the
// other's.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildZip, readZip } from '../bbmFiles';
import { buildLayoutFile, layoutSourceHere, parseLayoutSource, readLayoutFile, type LayoutSource } from '../layoutFile';
import { originalHere } from '../layouts/originalLayout';
import WEB_MADE_SOURCE from '../../../../packages/bbm/tests/fixtures/web-made-source.bld-layout?inline';
import DESKTOP_MADE_SOURCE from '../../../../packages/bbm/tests/fixtures/desktop-made-source.bld-layout?inline';
import TIGHT_CORNER from '../../../../packages/bbm/tests/fixtures/tight-corner.bbm?raw';

const dec = new TextDecoder();
const enc = new TextEncoder();
const bytesOf = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const manifestOf = async (bytes: Uint8Array) => JSON.parse(dec.decode((await readZip(bytes))[0]!.data)) as Record<string, unknown>;

/** What both fixtures say they came from. */
const SHARED: LayoutSource = {
  server: 'https://collab.example.org',
  layoutId: 'L-42',
  title: 'Show 2026',
  exportedAt: '2026-10-01T12:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('layout file source', () => {
  it('writes source for a server layout, and nothing for a local one', async () => {
    const withSource = await manifestOf(await buildLayoutFile({ bbm: '<Map/>', sidecar: null, source: SHARED }));
    expect(withSource.source).toEqual(SHARED);
    const local = await manifestOf(await buildLayoutFile({ bbm: '<Map/>', sidecar: null }));
    expect(local).not.toHaveProperty('source');
    expect(local).toEqual({ format: 'bld-layout', generator: 'Brick Layout Designer (web)', version: 1 });
  });

  it('names this server, the layout and the time for a web download', () => {
    const s = layoutSourceHere('L-7', 'Club table', new Date(Date.UTC(2026, 9, 1, 8)), 'https://collab.aronwk.com/');
    expect(s).toEqual({ server: 'https://collab.aronwk.com', layoutId: 'L-7', title: 'Club table', exportedAt: '2026-10-01T08:00:00.000Z' });
  });

  it('reads the web-made and desktop-made fixtures alike', async () => {
    for (const fixture of [WEB_MADE_SOURCE, DESKTOP_MADE_SOURCE]) {
      const l = await readLayoutFile(bytesOf(fixture));
      expect(l.warnings).toEqual([]);
      expect(l.bbm.replace(/\r\n/g, '\n').trim()).toBe(TIGHT_CORNER.replace(/\r\n/g, '\n').trim());
      expect(l.source).toEqual(SHARED);
      expect(l.manifest.futureField).toEqual({ kept: true });
    }
  });

  it('keeps the source and fields it doesn’t know when re-saved', async () => {
    const l = await readLayoutFile(bytesOf(DESKTOP_MADE_SOURCE));
    const again = await buildLayoutFile({ bbm: l.bbm, sidecar: null, keepManifest: { ...l.manifest, version: 99 }, ...(l.source ? { source: l.source } : {}) });
    const m = await manifestOf(again);
    expect(m.futureField).toEqual({ kept: true });
    expect(m.source).toEqual(SHARED);
    // Its own fields are this version's, whatever the kept manifest said.
    expect(m).toMatchObject({ format: 'bld-layout', version: 1, generator: 'Brick Layout Designer (web)' });
    expect((await readLayoutFile(again)).source).toEqual(SHARED);
  });

  it('opens the same with the source stripped, as a reader that ignores it would', async () => {
    const bytes = bytesOf(WEB_MADE_SOURCE);
    const entries = await readZip(bytes);
    const { source: _gone, ...rest } = JSON.parse(dec.decode(entries[0]!.data)) as Record<string, unknown>;
    const stripped = buildZip([{ name: 'manifest.json', data: enc.encode(JSON.stringify(rest)) }, ...entries.slice(1)]);
    const a = await readLayoutFile(bytes);
    const b = await readLayoutFile(stripped);
    expect(b.source).toBeUndefined();
    expect(b.bbm).toBe(a.bbm);
    expect(b.warnings).toEqual(a.warnings);
  });

  it('ignores a source that isn’t whole or sensible', () => {
    expect(parseLayoutSource(undefined)).toBeUndefined();
    expect(parseLayoutSource('https://x.org')).toBeUndefined();
    expect(parseLayoutSource({ server: 'javascript:alert(1)', layoutId: 'L' })).toBeUndefined();
    expect(parseLayoutSource({ server: 'https://x.org' })).toBeUndefined();
    expect(parseLayoutSource({ server: 'https://x.org', layoutId: '  ' })).toBeUndefined();
    expect(parseLayoutSource({ server: 'https://x.org/some/page/', layoutId: 'L', title: 5 })).toEqual({
      server: 'https://x.org',
      layoutId: 'L',
      title: '',
      exportedAt: '',
    });
  });
});

describe('open the original', () => {
  const stubLayout = (status: number) =>
    vi.stubGlobal('fetch', async (input: string) => {
      expect(input).toBe('/api/layouts/L-42');
      return new Response(JSON.stringify(status === 200 ? { layout: { id: 'L-42', title: 'Show 2026' }, role: 'editor' } : { error: 'not_found' }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    });

  it('offers it when the file came from this server and you can open it', async () => {
    stubLayout(200);
    expect(await originalHere(SHARED, 'https://collab.example.org')).toEqual({ id: 'L-42', title: 'Show 2026' });
  });

  it('doesn’t when the file came from another server', async () => {
    stubLayout(200);
    expect(await originalHere(SHARED, 'https://other.example.org')).toBeNull();
    expect(await originalHere(undefined, 'https://collab.example.org')).toBeNull();
  });

  it('doesn’t when the layout is gone or isn’t yours to open', async () => {
    stubLayout(404);
    expect(await originalHere(SHARED, 'https://collab.example.org')).toBeNull();
  });
});
