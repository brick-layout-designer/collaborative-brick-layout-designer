// `.bbm.cld` sidecar reader/writer.
//
// The sidecar is a single JSON document holding fork-only metadata that
// vanilla BlueBrick doesn't understand: anchored labels, modules, venue.
// Per the desktop's `docs/bbm-cld-schema.md`:
//   - schemaVersion: integer (currently 1)
//   - bbmHashSha256: lowercase hex of the sibling .bbm bytes (sync detection)
//   - anchoredLabels / modules / venue: optional arrays / object
//
// Forward-compat rule: readers REJECT `schemaVersion > CURRENT_SCHEMA_VERSION`
// rather than silently dropping unknown fields. Writers preserve unknown
// fields they read (round-trip safety) by holding them in `extras`.

// Note: `hashBbmBytes` lives in ./sidecarHash.ts so this module has zero
// runtime dependencies on `node:crypto` — that lets the browser bundle
// import the readers/writers and the type definitions without a Node-only
// shim. The hash helper imports `node:crypto` lazily; it's server-side only.

export const CURRENT_SCHEMA_VERSION = 1;

export type EdgeKind = 0 | 1 | 2; // 0=Wall, 1=Door, 2=Open

export type AnchoredLabelKind = 0 | 1 | 2 | 3; // 0=World, 1=Brick, 2=Group, 3=Module

export interface AnchoredLabel {
  id: string;
  text: string;
  font: { family: string; size: number; style: string };
  color: { known: boolean; argb: number; name: string };
  kind: AnchoredLabelKind;
  /** Brick / group / module GUID; empty for World. */
  targetId: string;
  offset: { x: number; y: number };
  rot: number;
  minZoom: number;
}

export interface SidecarModule {
  id: string;
  name: string;
  members: string[];
  /** 3x3 row-major affine transform; identity = [1,0,0,0,1,0,0,0,1]. */
  transform: number[];
  sourceFile?: string;
  /** ISO 8601 timestamp string. */
  importedAt?: string;
}

export interface VenueEdge {
  kind: EdgeKind;
  doorWidthStuds: number;
  label: string;
  poly: { x: number; y: number }[];
}

export interface VenueObstacle {
  label: string;
  poly: { x: number; y: number }[];
}

export interface Venue {
  name: string;
  enabled: boolean;
  minWalkwayStuds: number;
  bounds: { x: number; y: number; w: number; h: number };
  edges: VenueEdge[];
  obstacles: VenueObstacle[];
}

export interface BackgroundImage {
  /**
   * Server-relative URL (e.g. `/api/layouts/<id>/background-image`).
   * Empty when the sidecar came from the desktop app, which stores a local
   * file `path` instead — the image itself isn't in the sidecar.
   */
  url: string;
  /**
   * Desktop's local image file path (SidecarIO.cpp `backgroundImage.path`).
   * Preserved so a desktop sidecar round-trips through the web without
   * losing it; the web can't load it.
   */
  path?: string;
  /** Opacity 0..1. Desktop default 0.5. */
  opacity: number;
  /** Placement rect in studs. null/absent = stretch to scene bounds. */
  rect?: { x: number; y: number; w: number; h: number };
}

export interface Sidecar {
  schemaVersion: number;
  /** Lowercase hex of the .bbm bytes at write time, or empty when unknown. */
  bbmHashSha256: string;
  anchoredLabels?: AnchoredLabel[];
  modules?: SidecarModule[];
  venue?: Venue;
  backgroundImage?: BackgroundImage;
  /** Unknown top-level fields preserved verbatim across round-trip. */
  extras?: Record<string, unknown>;
}

export function readSidecar(raw: string): Sidecar {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const schemaVersion = numberField(parsed, 'schemaVersion');
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported sidecar schemaVersion ${schemaVersion} (expected ≤ ${CURRENT_SCHEMA_VERSION})`,
    );
  }

  const sidecar: Sidecar = {
    schemaVersion,
    bbmHashSha256: typeof parsed.bbmHashSha256 === 'string' ? parsed.bbmHashSha256 : '',
  };

  if (Array.isArray(parsed.anchoredLabels)) {
    sidecar.anchoredLabels = parsed.anchoredLabels as AnchoredLabel[];
  }
  if (Array.isArray(parsed.modules)) {
    sidecar.modules = parsed.modules as SidecarModule[];
  }
  if (parsed.venue && typeof parsed.venue === 'object') {
    sidecar.venue = parsed.venue as Venue;
  }
  const bg = readBackgroundImage(parsed.backgroundImage);
  if (bg) sidecar.backgroundImage = bg;

  const knownKeys = new Set([
    'schemaVersion',
    'bbmHashSha256',
    'anchoredLabels',
    'modules',
    'venue',
    'backgroundImage',
  ]);
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(parsed)) {
    if (!knownKeys.has(key)) extras[key] = parsed[key];
  }
  if (Object.keys(extras).length > 0) sidecar.extras = extras;

  return sidecar;
}

export interface WriteSidecarOptions {
  /**
   * If supplied, we use this string as `bbmHashSha256`, overriding whatever
   * was in the Sidecar object — that's the desired behaviour because the
   * hash MUST reflect the current .bbm content for sync detection to work.
   *
   * The caller computes the hash via `hashBbmBytes` (server-side, lives in
   * sidecarHash.ts) and passes the digest in. Keeping the hashing out of
   * this module means sidecar.ts has no `node:crypto` import, so the web
   * bundle can include it without a Node shim.
   */
  bbmHashSha256?: string;
  /** Indentation: defaults to 2 spaces. */
  indent?: number;
}

export function writeSidecar(sidecar: Sidecar, opts: WriteSidecarOptions = {}): string {
  const indent = opts.indent ?? 2;

  const out: Record<string, unknown> = {
    schemaVersion: sidecar.schemaVersion,
    bbmHashSha256: opts.bbmHashSha256 ?? sidecar.bbmHashSha256,
  };
  if (sidecar.anchoredLabels) out.anchoredLabels = sidecar.anchoredLabels;
  if (sidecar.modules) out.modules = sidecar.modules;
  if (sidecar.venue) out.venue = sidecar.venue;
  if (sidecar.backgroundImage) out.backgroundImage = encodeBackgroundImage(sidecar.backgroundImage);
  if (sidecar.extras) {
    for (const [k, v] of Object.entries(sidecar.extras)) out[k] = v;
  }

  return JSON.stringify(out, null, indent);
}

/**
 * Accepts both shapes:
 *   - web:     { url, opacity, rect?: { x, y, w, h } }
 *   - desktop: { path, opacity, rect?: [x, y, w, h] }   (SidecarIO.cpp readSidecar)
 * and normalises to the web `BackgroundImage` shape, keeping `path`.
 * Opacity defaults to 0.5 like desktop.
 */
function readBackgroundImage(raw: unknown): BackgroundImage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url : '';
  const path = typeof o.path === 'string' ? o.path : undefined;
  if (!url && !path) return undefined;
  const opacity = typeof o.opacity === 'number' && Number.isFinite(o.opacity) ? o.opacity : 0.5;
  const bg: BackgroundImage = { url, opacity };
  if (path !== undefined) bg.path = path;
  const rect = readRect(o.rect);
  if (rect) bg.rect = rect;
  return bg;
}

function readRect(raw: unknown): BackgroundImage['rect'] {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  let x, y, w, h;
  if (Array.isArray(raw)) {
    if (raw.length !== 4) return undefined;
    [x, y, w, h] = raw.map(num);
  } else if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    [x, y, w, h] = [r.x, r.y, r.w, r.h].map(num);
  } else {
    return undefined;
  }
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

/**
 * Written so both apps can read it: desktop reads `path` + `rect` as a
 * 4-array and ignores `url`; `readSidecar` accepts either shape. Key
 * order follows desktop's (QJsonObject sorts keys alphabetically).
 */
function encodeBackgroundImage(bg: BackgroundImage): Record<string, unknown> {
  const out: Record<string, unknown> = { opacity: bg.opacity };
  if (bg.path !== undefined) out.path = bg.path;
  if (bg.rect) out.rect = [bg.rect.x, bg.rect.y, bg.rect.w, bg.rect.h];
  out.url = bg.url;
  return out;
}

function numberField(node: Record<string, unknown>, key: string): number {
  const v = node[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`sidecar field ${key} is not a finite number`);
  }
  return v;
}
