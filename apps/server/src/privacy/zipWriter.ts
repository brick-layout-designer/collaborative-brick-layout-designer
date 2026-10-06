// A small zip writer that streams entries straight to a file, so a big
// data download is never held in memory whole. Each entry is deflated
// (or stored, when deflating doesn't help: pictures already are). Plain
// PKZIP 2.0 with 32-bit sizes, which every unzip tool reads; the privacy
// size cap (at most 4000 MB) keeps a download well inside that.
//
// `maxBytes` stops the zip as soon as it would grow past the cap: add()
// throws ZipTooBigError and the caller deletes the half-written file.

import { closeSync, openSync, writeSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';

export class ZipTooBigError extends Error {
  constructor(public readonly maxBytes: number) {
    super('zip_too_big');
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date and time for the entries (the zip's own clock). */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

interface Central {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

export class ZipFileWriter {
  private fd: number;
  private offset = 0;
  private entries: Central[] = [];
  private names = new Set<string>();
  private readonly stamp: { time: number; date: number };

  constructor(
    path: string,
    private readonly maxBytes: number = Number.MAX_SAFE_INTEGER,
    now: Date = new Date(),
  ) {
    this.fd = openSync(path, 'w', 0o600);
    this.stamp = dosTime(now);
  }

  /** Bytes written so far. */
  get size(): number {
    return this.offset;
  }

  /**
   * A name not used yet in this zip: "a.json", then "a (2).json". Zip
   * paths use forward slashes; anything a file system dislikes is
   * replaced, and each part is kept short.
   */
  uniqueName(path: string): string {
    const clean = path
      .split('/')
      .map((part) => {
        // eslint-disable-next-line no-control-regex -- control characters are what this strips
        const p = part.replace(/[\\:*?"<>|\x00-\x1F]+/g, '_').replace(/^\.+/, '_').trim();
        return (p || '_').slice(0, 100);
      })
      .join('/');
    if (!this.names.has(clean)) return clean;
    const dot = clean.lastIndexOf('.');
    const slash = clean.lastIndexOf('/');
    const [stem, ext] = dot > slash + 1 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ''];
    for (let n = 2; ; n++) {
      const next = `${stem} (${n})${ext}`;
      if (!this.names.has(next)) return next;
    }
  }

  private write(buf: Uint8Array): void {
    if (this.offset + buf.length > this.maxBytes) throw new ZipTooBigError(this.maxBytes);
    writeSync(this.fd, buf);
    this.offset += buf.length;
  }

  /** Add one file. Returns the name it got (made unique). */
  add(path: string, data: Uint8Array | string): string {
    // 32-bit zips hold at most 65535 entries.
    if (this.entries.length >= 65_000) throw new ZipTooBigError(this.maxBytes);
    const name = this.uniqueName(path);
    this.names.add(name);
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(bytes);
    const deflated = bytes.length > 64 ? deflateRawSync(bytes) : null;
    const useDeflate = !!deflated && deflated.length < bytes.length;
    const body = useDeflate ? deflated! : bytes;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.stamp.time, 10);
    local.writeUInt16LE(this.stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const offset = this.offset;
    this.write(local);
    this.write(nameBytes);
    this.write(body);
    this.entries.push({ name: nameBytes, crc, method, compressed: body.length, size: bytes.length, offset });
    return name;
  }

  /** Write the directory and close the file. */
  finish(): number {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(this.stamp.time, 12);
      c.writeUInt16LE(this.stamp.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      this.write(c);
      this.write(e.name);
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(this.offset - start, 12);
    eocd.writeUInt32LE(start, 16);
    this.write(eocd);
    this.close();
    return this.offset;
  }

  close(): void {
    if (this.fd >= 0) {
      closeSync(this.fd);
      this.fd = -1;
    }
  }
}
