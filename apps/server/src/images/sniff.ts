// What kind of picture a file really is, from its first bytes. Uploaded
// pictures that are stored as sent (background images, custom-part
// sprites) must be the image type they claim; anything else is refused.

export type SniffedImage = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImage(b: Uint8Array): SniffedImage | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The largest side a stored sprite may claim in its header (a 512-stud part at 32 px a stud). */
export const MAX_SPRITE_SIDE = 16384;

/** A PNG's size from its IHDR, or null when it isn't a PNG. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (sniffImage(buf) !== 'image/png' || buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Whether `bytes` really are the `mime` they claim (image/jpg counts as image/jpeg). */
export function isImageOfType(bytes: Uint8Array, mime: string): boolean {
  const want = mime === 'image/jpg' ? 'image/jpeg' : mime;
  return sniffImage(bytes) === want;
}
