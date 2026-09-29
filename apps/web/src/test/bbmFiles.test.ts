// @vitest-environment node
// Local .bbm + .bbm.bld download / drop (desktop MainWindowFileIO.cpp:84-94).

import { describe, expect, it } from 'vitest';
import {
  buildZip,
  crc32,
  layoutsFromFiles,
  localBbmDownload,
  pairLayoutFiles,
  readZip,
  sanitizeFilename,
  sha256Hex,
} from '../bbmFiles';

const enc = new TextEncoder();
const dec = new TextDecoder();

function file(name: string, text: string | Uint8Array): File {
  return new File([typeof text === 'string' ? text : (text as BlobPart)], name);
}

describe('zip', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips stored entries', async () => {
    const zip = buildZip([{ name: 'a.bbm', data: enc.encode('<Map/>') }, { name: 'a.bbm.bld', data: enc.encode('{}') }]);
    const back = await readZip(zip);
    expect(back.map((e) => [e.name, dec.decode(e.data)])).toEqual([['a.bbm', '<Map/>'], ['a.bbm.bld', '{}']]);
  });

  it('reads deflated entries (zips made by other tools)', async () => {
    // A one-entry zip with a deflated (method 8) entry.
    const body = enc.encode('<Map>hello hello hello</Map>');
    const deflated = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const name = enc.encode('x.bbm');
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, deflated.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, deflated.length, true);
    cv.setUint32(24, body.length, true);
    cv.setUint16(28, name.length, true);
    cen.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, cen.length, true);
    ev.setUint32(16, local.length + deflated.length, true);
    const bytes = new Uint8Array([...local, ...deflated, ...cen, ...end]);
    const [e] = await readZip(bytes);
    expect(dec.decode(e!.data)).toBe('<Map>hello hello hello</Map>');
    await expect(readZip(enc.encode('not a zip at all, definitely not'))).rejects.toThrow('not a zip');
  });
});

describe('localBbmDownload', () => {
  it('is the bare .bbm when there is no sidecar', () => {
    const f = localBbmDownload('My: Layout', '<Map/>', null);
    expect(f).toMatchObject({ filename: 'My_ Layout.bbm', type: 'application/xml' });
    expect(dec.decode(f.data)).toBe('<Map/>');
  });

  it('zips the .bbm with its .bbm.bld under the server export names', async () => {
    const f = localBbmDownload('Club Show', '<Map/>', '{"anchoredLabels":[]}');
    expect(f).toMatchObject({ filename: 'Club Show.zip', type: 'application/zip' });
    const entries = await readZip(f.data);
    expect(entries.map((e) => e.name)).toEqual(['Club Show.bbm', 'Club Show.bbm.bld']);
    expect(dec.decode(entries[1]!.data)).toBe('{"anchoredLabels":[]}');
  });

  it('sanitizes titles like the server', () => {
    expect(sanitizeFilename('a/b\\c?')).toBe('a_b_c_');
    expect(sanitizeFilename('   ')).toBe('layout');
    expect(sanitizeFilename('x'.repeat(100))).toHaveLength(80);
  });

  it('hashes the .bbm like desktop (lowercase hex SHA-256)', async () => {
    expect(await sha256Hex('<Map/>')).toBe('e47cd14a0d4f339d78c3e9d648f7fa98878c60be6e3a0e9a93ebf74f1e8c6b2f');
  });
});

describe('dropped files', () => {
  const named = (name: string, text: string) => ({ name, text: async () => text });

  it('pairs each .bbm with its .bbm.bld (preferring it over a legacy .bbm.cld)', async () => {
    const out = await pairLayoutFiles([
      named('A.bbm', 'a'),
      named('a.bbm.cld', 'legacy'),
      named('A.bbm.bld', 'sidecar-a'),
      named('B.bbm', 'b'),
      named('orphan.bbm.bld', 'x'),
    ]);
    expect(out).toEqual([
      { name: 'A.bbm', bbm: 'a', sidecar: 'sidecar-a' },
      { name: 'B.bbm', bbm: 'b' },
    ]);
  });

  it('opens loose files and the pair inside a downloaded .zip', async () => {
    const zip = localBbmDownload('Z', '<Z/>', '{"z":1}').data;
    const out = await layoutsFromFiles([file('L.bbm', '<L/>'), file('L.bbm.bld', '{"l":1}'), file('Z.zip', zip)]);
    expect(out).toEqual([
      { name: 'L.bbm', bbm: '<L/>', sidecar: '{"l":1}' },
      { name: 'Z.bbm', bbm: '<Z/>', sidecar: '{"z":1}' },
    ]);
  });

  it('converts other map formats when given a converter, and skips them without one', async () => {
    const seen: string[] = [];
    const convert = async (name: string, bytes: Uint8Array) => {
      seen.push(`${name}:${dec.decode(bytes)}`);
      return { bbm: `<from-${name}/>`, warnings: /\.ncp$/i.test(name) ? ['No part is mapped to these 4DBrix parts: X'] : [] };
    };
    const files = [file('a.ldr', '0 a'), file('b.NCP', '<data/>'), file('c.bbm', '<C/>')];
    expect(await layoutsFromFiles(files, convert)).toEqual([
      { name: 'c.bbm', bbm: '<C/>' },
      { name: 'a.ldr', bbm: '<from-a.ldr/>' },
      { name: 'b.NCP', bbm: '<from-b.NCP/>', warnings: ['No part is mapped to these 4DBrix parts: X'] },
    ]);
    expect(seen).toEqual(['a.ldr:0 a', 'b.NCP:<data/>']);
    expect(await layoutsFromFiles(files)).toEqual([{ name: 'c.bbm', bbm: '<C/>' }]);
  });
});
