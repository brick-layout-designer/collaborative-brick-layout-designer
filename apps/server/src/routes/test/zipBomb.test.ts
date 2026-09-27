// Regression test: extractZip must not inflate an entry past its declared
// uncompressed size (a tiny deflate stream can expand to gigabytes).

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bufConcat, bufCopy } from '../../test/helpers.js';
import { extractZip } from '../admin.js';

function deflateEntry(name: string, compressed: Buffer, declaredSize: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const lh = Buffer.alloc(30 + nameBytes.length);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(8, 8); // deflate
  lh.writeUInt32LE(compressed.length, 18);
  lh.writeUInt32LE(declaredSize, 22);
  lh.writeUInt16LE(nameBytes.length, 26);
  bufCopy(nameBytes, lh, 30);
  return bufConcat([lh, compressed]);
}

describe('extractZip — decompression bombs', () => {
  it('stops inflating at the declared size instead of expanding the whole stream', async () => {
    // 32 MiB of zeros compresses to ~32 KB but claims to be 1 KB.
    const compressed = deflateRawSync(new Uint8Array(32 * 1024 * 1024));
    const zip = deflateEntry('bomb.xml', compressed, 1024);
    const dir = await mkdtemp(join(tmpdir(), 'zip-bomb-'));
    try {
      await expect(extractZip(zip, dir)).rejects.toThrow(/zip bomb/);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
