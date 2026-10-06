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
/**
 * Kept under what common WAFs accept: CrowdSec AppSec refuses JSON bodies past
 * about 10 MiB, and base64 adds a third, so 7 MB of picture is the safe top.
 */
export const COVER_MAX_CEILING = 7 * MB;
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

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export type CoverRead =
  | { ok: true; bytes: Buffer; image: Buffer; small: Buffer }
  | { ok: false; code: number; body: { error: string; maxBytes?: number } };

/**
 * A cover upload's JSON body, `{mime, data}` with the picture as base64
 * (never an octet-stream body): PNG, JPEG or WebP by its first bytes, no
 * bigger than Admin › Settings allows, and readable. The re-encoded picture
 * and its card copy, or the refusal to send. Collections and catalog items
 * both take covers this way.
 */
export async function readCoverBody(body: { mime?: unknown; data?: unknown } | undefined): Promise<CoverRead> {
  const mime = body?.mime;
  const data = body?.data;
  const bad = { ok: false as const, code: 400, body: { error: 'invalid_cover' } };
  if (!COVER_MIMES.includes(mime as CoverMime) || typeof data !== 'string' || !BASE64_RE.test(data)) return bad;
  const max = (await coverMaxBytes()).value;
  const tooBig = { ok: false as const, code: 413, body: { error: 'cover_too_large', maxBytes: max } };
  if (Math.floor((data.length * 3) / 4) - 2 > max) return tooBig;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > max) return tooBig;
  if (!sniffCover(bytes)) return bad;
  const enc = await encodeCover(bytes);
  if (!enc) return bad;
  return { ok: true, bytes, image: enc.image, small: enc.small };
}
