// Collection covers: a picture a curator uploads (PNG, JPEG or WebP, often
// a phone photo). It's checked by its first bytes, not by what the request
// says it is, then re-encoded as WebP no wider than COVER_WIDTH, turned the
// right way up and with no metadata (EXIF, GPS, ...). The original is never
// stored. A COVER_SMALL_WIDTH copy is kept for cards.

import sharp from 'sharp';
import { getPlatformSettings } from '../auth/platformSettings.js';
import { env } from '../env.js';

export const COVER_WIDTH = 1200;
export const COVER_SMALL_WIDTH = 480;
const MB = 1024 * 1024;
/** What an admin may set the biggest upload to. */
export const COVER_MAX_FLOOR = 100 * 1024;
export const COVER_MAX_CEILING = 20 * MB;
/** The JSON body at the ceiling: base64 is 4/3 the size, plus a little for the rest. */
export const COVER_BODY_LIMIT = Math.ceil((COVER_MAX_CEILING * 4) / 3) + 64 * 1024;
/** A 48 MP phone photo is 8000 × 6000; refuse "decompression bombs" past this. */
const MAX_INPUT_PIXELS = 100_000_000;

export type CoverMime = 'image/png' | 'image/jpeg' | 'image/webp';
export const COVER_MIMES: readonly CoverMime[] = ['image/png', 'image/jpeg', 'image/webp'];

/** What the first bytes say the file is, or null when it's none of the three. */
export function sniffCover(b: Buffer): CoverMime | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The stored cover and its card copy, or null when sharp can't read it. */
export async function encodeCover(bytes: Buffer): Promise<{ image: Buffer; small: Buffer } | null> {
  try {
    // rotate() turns it the way the camera's EXIF says, before the EXIF goes.
    const upright = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
    const image = await upright.clone().resize({ width: COVER_WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const small = await sharp(image).resize({ width: COVER_SMALL_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { image, small };
  } catch {
    return null;
  }
}

export interface CoverMax {
  /** What applies now. */
  value: number;
  /** The admin's setting, kept even while forced. */
  setting: number;
  /** The env var forcing it, or null. */
  forcedBy: string | null;
}

/** The biggest cover upload: Admin › Settings, unless COLLECTION_COVER_MAX_BYTES forces it. */
export async function coverMaxBytes(): Promise<CoverMax> {
  const setting = (await getPlatformSettings()).collectionCoverMaxBytes;
  const forced = env.collectionCoverMaxBytesForced;
  return forced === null ? { value: setting, setting, forcedBy: null } : { value: forced, setting, forcedBy: 'COLLECTION_COVER_MAX_BYTES' };
}
