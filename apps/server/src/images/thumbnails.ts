// Module pictures. The editor draws one (up to 1024 px on its longest
// side) and sends it as PNG or WebP; the server re-encodes it as WebP, no
// bigger than THUMBNAIL_SIDE, with no metadata, so what's stored and
// served is always ours. Lists ask for `?size=small`: a SMALL_SIDE copy,
// made once per picture and kept in memory.

import { createHash } from 'node:crypto';
import sharp from 'sharp';

/** Longest side of a stored module picture. */
export const THUMBNAIL_SIDE = 1024;
/** Longest side of the copy lists use (sharp at 96 px on a 2.5× screen). */
export const SMALL_SIDE = 256;
/**
 * Largest picture accepted, before re-encoding. A 1024 px PNG of a busy
 * module is about 1–2 MB; WebP is a few hundred KB. A sanity bound, not a
 * policy: the storage limits (Admin › Limits) are what's counted.
 */
export const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;
/** The JSON body: base64 is 4/3 the size, plus a little for the rest. */
export const THUMBNAIL_BODY_LIMIT = Math.ceil((MAX_THUMBNAIL_BYTES * 4) / 3) + 64 * 1024;
/** Refuse pictures that decode to more pixels than this (a "decompression bomb"). */
const MAX_INPUT_PIXELS = 4096 * 4096;
const QUALITY = 82;

/**
 * `bytes` (PNG or WebP) as a WebP no bigger than `side` on its longest
 * side, without metadata. Null when it isn't a picture sharp can read.
 */
export async function reencode(bytes: Buffer, side = THUMBNAIL_SIDE): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * The longest side of a PNG or WebP, read from its first 30 bytes (no
 * decoding), or null when the header isn't one we know.
 */
export function imageSide(head: Uint8Array | null | undefined): number | null {
  if (!head || head.length < 26) return null;
  const b = Buffer.from(head.buffer, head.byteOffset, head.byteLength);
  // PNG: the IHDR chunk's width and height.
  if (b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR') return Math.max(b.readUInt32BE(16), b.readUInt32BE(20));
  if (b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ' && b.length >= 30) return Math.max(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L' && b.length >= 25) {
    const bits = b.readUInt32LE(21);
    return Math.max((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X' && b.length >= 30) return Math.max(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
  return null;
}

/** The first bytes of a stored picture, enough for imageSide. */
export const HEAD_BYTES = 30;

const SMALL_CACHE_MAX = 2000;
const smallCache = new Map<string, Buffer>();

/** A picture's content key (its ETag). */
export function pictureKey(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('base64url').slice(0, 20);
}

/**
 * The small copy of a stored picture, made once and kept (the oldest are
 * dropped past SMALL_CACHE_MAX). A picture already that small is itself.
 */
export async function smallCopy(bytes: Buffer, mime: string): Promise<{ bytes: Buffer; mime: string; key: string }> {
  const key = pictureKey(bytes);
  const side = imageSide(bytes.subarray(0, HEAD_BYTES));
  if (side !== null && side <= SMALL_SIDE) return { bytes, mime, key };
  const hit = smallCache.get(key);
  if (hit) {
    // Most recently used goes last.
    smallCache.delete(key);
    smallCache.set(key, hit);
    return { bytes: hit, mime: 'image/webp', key: `s-${key}` };
  }
  const out = await reencode(bytes, SMALL_SIDE);
  if (!out) return { bytes, mime, key };
  smallCache.set(key, out);
  while (smallCache.size > SMALL_CACHE_MAX) smallCache.delete(smallCache.keys().next().value as string);
  return { bytes: out, mime: 'image/webp', key: `s-${key}` };
}

/** For tests: how many small copies are kept. */
export function smallCacheSize(): number {
  return smallCache.size;
}
