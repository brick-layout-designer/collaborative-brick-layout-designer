// Club logos: a picture a club admin uploads (PNG, JPEG, WebP or SVG). It's
// checked by its first bytes (or, for an SVG, read as text and checked for
// anything that reaches outside the picture), then drawn into a WebP no
// bigger than LOGO_SIDE on its longest side, with no metadata. Only that
// WebP is kept and served: an SVG is never stored or sent back as SVG.

import sharp from 'sharp';
import { coverMaxBytes, sniffCover } from './covers.js';

export const LOGO_SIDE = 512;
/** The biggest SVG taken, whatever the picture limit (Admin › Settings) says. */
export const LOGO_SVG_MAX_BYTES = 256 * 1024;
/** The JSON body for the largest picture (base64 is 4/3 the size). */
export { COVER_BODY_LIMIT as LOGO_BODY_LIMIT } from './covers.js';
/** Refuse pictures past this many pixels before drawing them ("decompression bombs"). */
const MAX_INPUT_PIXELS = 50_000_000;

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
export const LOGO_MIMES: readonly LogoMime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

/**
 * Why an SVG isn't taken, or null when it's a plain picture: it must be
 * UTF-8 text with an <svg> element and nothing that reaches outside it (no
 * DOCTYPE or entities, scripts, embedded documents, event handlers,
 * stylesheets, or links and url()s to anything but its own parts).
 */
export function svgProblem(bytes: Buffer): string | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'not UTF-8 text';
  }
  if (text.includes('\u0000')) return 'a NUL character';
  const lower = text.toLowerCase();
  if (!/<svg[\s>]/.test(lower)) return 'no <svg> element';
  const banned: [RegExp, string][] = [
    [/<!doctype/i, 'a DOCTYPE'],
    [/<!entity/i, 'an entity'],
    [/<\?xml-stylesheet/i, 'a stylesheet'],
    [/<script[\s>/]/i, 'a script'],
    [/<(foreignobject|iframe|embed|object|audio|video|animate|set)[\s>/]/i, 'embedded content'],
    [/\son[a-z]+\s*=/i, 'an event handler'],
    [/@import/i, 'an @import'],
    // CSS escapes could spell url( another way.
    [/\\/i, 'a backslash'],
  ];
  for (const [re, what] of banned) if (re.test(text)) return what;
  // Links (href, xlink:href) and url()s may only point inside the picture.
  for (const m of lower.matchAll(/(?:^|[\s"'])(?:xlink:)?href\s*=\s*(["'])(.*?)\1/g)) if (!m[2]!.trim().startsWith('#')) return 'a link outside the picture';
  for (const m of lower.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) if (!m[2]!.trim().startsWith('#')) return 'a url() outside the picture';
  return null;
}

export type LogoRead = { ok: true; image: Buffer } | { ok: false; code: number; body: { error: string; maxBytes?: number; message?: string } };

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * An upload's JSON body, `{mime, data}` with the picture as base64: the
 * WebP to keep, or the refusal to send (400 not a picture we take, 413 too
 * big). The size limit is the picture limit in Admin › Settings, and at
 * most LOGO_SVG_MAX_BYTES for an SVG.
 */
export async function readLogoBody(body: { mime?: unknown; data?: unknown } | undefined): Promise<LogoRead> {
  const mime = body?.mime;
  const data = body?.data;
  const bad = (message: string): LogoRead => ({ ok: false, code: 400, body: { error: 'invalid_logo', message } });
  if (!LOGO_MIMES.includes(mime as LogoMime) || typeof data !== 'string' || !BASE64_RE.test(data)) {
    return bad('Choose a PNG, JPEG, WebP or SVG picture.');
  }
  const svg = mime === 'image/svg+xml';
  const pictureMax = (await coverMaxBytes()).value;
  const max = svg ? Math.min(LOGO_SVG_MAX_BYTES, pictureMax) : pictureMax;
  const tooBig: LogoRead = { ok: false, code: 413, body: { error: 'logo_too_large', maxBytes: max } };
  if (Math.floor((data.length * 3) / 4) - 2 > max) return tooBig;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > max) return tooBig;
  if (svg) {
    const why = svgProblem(bytes);
    if (why) return bad(`This SVG can't be used as a logo (it has ${why}). Try saving it as a PNG.`);
  } else if (!sniffCover(bytes)) {
    return bad('That file isn’t a PNG, JPEG or WebP picture.');
  }
  try {
    const image = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', ...(svg ? { density: 72 } : {}) })
      .rotate()
      .resize({ width: LOGO_SIDE, height: LOGO_SIDE, fit: 'inside', withoutEnlargement: !svg })
      .timeout({ seconds: 10 })
      .webp({ quality: 85 })
      .toBuffer();
    return { ok: true, image };
  } catch {
    return bad('That picture couldn’t be read.');
  }
}
