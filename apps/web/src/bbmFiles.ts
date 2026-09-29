// Local .bbm + .bbm.bld files: the editor's "Download .bbm" (and the
// offline Save fallback) and the window-level file drop.
//
// Desktop keeps a layout's labels, modules, venue and background image in
// a `<file>.bbm.bld` sidecar next to the `.bbm` and loads it with the
// .bbm (MainWindowFileIO.cpp:84-94). A browser download is one file, so
// the pair goes out as a `.zip` named like the server's export.zip
// (`<title>.zip` holding `<title>.bbm` + `<title>.bbm.bld`). Dropping a
// `.bbm` together with its `.bbm.bld` — or such a `.zip` — loads both.

/** Same rule as the server's export filenames (routes/layouts.ts sanitizeFilename). */
export function sanitizeFilename(s: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\\/:*?"<>|\x00-\x1F]+/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'layout';
}

// ---------------------------------------------------------------------------
// ZIP (PKZIP 2.0, stored entries — same writer as the server export)
// ---------------------------------------------------------------------------

let crcTable: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build an uncompressed ("stored") zip. */
export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(local, e.data);
    central.push(cen);
    offset += local.length + e.data.length;
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Read a zip's entries (stored or deflated) via its central directory.
 * Throws on anything else.
 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localOff = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(localOff + 26, true);
    const lExtraLen = v.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
    else throw new Error(`unsupported zip compression (${method})`);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Lowercase-hex SHA-256 (desktop's `bbmHashSha256`), or undefined without WebCrypto. */
export async function sha256Hex(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The file a local download delivers: the `.bbm` alone when there is no
 * sidecar, else a `.zip` with the `.bbm` and its `.bbm.bld`.
 */
export function localBbmDownload(
  title: string,
  bbmXml: string,
  sidecarJson: string | null,
): { filename: string; type: string; data: Uint8Array } {
  const safe = sanitizeFilename(title);
  const enc = new TextEncoder();
  if (sidecarJson === null) return { filename: `${safe}.bbm`, type: 'application/xml', data: enc.encode(bbmXml) };
  return {
    filename: `${safe}.zip`,
    type: 'application/zip',
    data: buildZip([
      { name: `${safe}.bbm`, data: enc.encode(bbmXml) },
      { name: `${safe}.bbm.bld`, data: enc.encode(sidecarJson) },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Drop
// ---------------------------------------------------------------------------

/** A dropped layout: the `.bbm` text and, when found, its sidecar text. */
export interface DroppedLayout {
  name: string;
  bbm: string;
  sidecar?: string;
  /** What the conversion from another map format skipped. */
  warnings?: string[];
}

/** Turns an LDraw / TrackDesigner / 4DBrix file into .bbm text (mapFormats.ts). */
export type MapConverter = (name: string, bytes: Uint8Array) => Promise<{ bbm: string; warnings: string[] }>;

const MAP_FILE = /\.(ldr|mpd|tdl|ncp)$/i;

interface NamedText {
  name: string;
  text: () => Promise<string>;
}

const SIDECAR_EXT = /\.bbm\.(bld|cld)$/i;

/**
 * Pair every `.bbm` with the `<same name>.bbm.bld` (or legacy `.bbm.cld`)
 * dropped alongside it. Sidecars without their `.bbm` are ignored.
 */
export async function pairLayoutFiles(files: readonly NamedText[]): Promise<DroppedLayout[]> {
  const sidecars = new Map<string, NamedText>();
  for (const f of files) {
    const m = SIDECAR_EXT.exec(f.name);
    if (!m) continue;
    const key = f.name.slice(0, m.index).toLowerCase();
    // Desktop's own name (.bbm.bld) wins over the legacy one.
    if (!sidecars.has(key) || m[1]!.toLowerCase() === 'bld') sidecars.set(key, f);
  }
  const out: DroppedLayout[] = [];
  for (const f of files) {
    if (!/\.bbm$/i.test(f.name)) continue;
    const sc = sidecars.get(f.name.slice(0, -4).toLowerCase());
    const entry: DroppedLayout = { name: f.name, bbm: await f.text() };
    if (sc) entry.sidecar = await sc.text();
    out.push(entry);
  }
  return out;
}

/**
 * Layouts in dropped files: loose `.bbm` / `.bbm.bld` files plus the
 * contents of any `.zip`, and — given a converter — LDraw, TrackDesigner
 * and 4DBrix maps.
 */
export async function layoutsFromFiles(files: readonly File[], convertMap?: MapConverter): Promise<DroppedLayout[]> {
  const loose: NamedText[] = [];
  const out: DroppedLayout[] = [];
  const dec = new TextDecoder();
  for (const f of files) {
    if (MAP_FILE.test(f.name)) {
      if (!convertMap) continue;
      const { bbm, warnings } = await convertMap(f.name, new Uint8Array(await f.arrayBuffer()));
      out.push({ name: f.name, bbm, ...(warnings.length ? { warnings } : {}) });
    } else if (/\.zip$/i.test(f.name)) {
      const entries = await readZip(new Uint8Array(await f.arrayBuffer()));
      const named = entries.map((e) => ({ name: e.name.split('/').pop() ?? e.name, text: async () => dec.decode(e.data) }));
      out.push(...(await pairLayoutFiles(named)));
    } else {
      loose.push({ name: f.name, text: () => f.text() });
    }
  }
  return [...(await pairLayoutFiles(loose)), ...out];
}
