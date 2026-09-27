// Venue files — port of desktop saveload/VenueIO.cpp. Desktop writes
// `*.bld-venue` JSON tagged `"schema": "bld-venue/1"`; older web builds
// wrote the bare Venue object as `*.cld-venue`. Both are read; files are
// written in the desktop format so they open in either app.

import type { Venue } from '@cld/bbm';

type EdgeKind = Venue['edges'][number]['kind'];

export const VENUE_SCHEMA = 'bld-venue/1';
export const VENUE_FILE_EXT = '.bld-venue';
export const VENUE_FILE_ACCEPT = '.bld-venue,.cld-venue,.json';

export function writeVenueFile(v: Venue): string {
  return `${JSON.stringify(
    {
      schema: VENUE_SCHEMA,
      name: v.name,
      enabled: v.enabled,
      minWalkwayStuds: v.minWalkwayStuds,
      bounds: { x: v.bounds.x, y: v.bounds.y, w: v.bounds.w, h: v.bounds.h },
      edges: v.edges.map((e) => ({
        kind: e.kind,
        doorWidthStuds: e.doorWidthStuds,
        label: e.label,
        poly: e.poly.map((p) => ({ x: p.x, y: p.y })),
      })),
      obstacles: v.obstacles.map((o) => ({ label: o.label, poly: o.poly.map((p) => ({ x: p.x, y: p.y })) })),
    },
    null,
    4,
  )}\n`;
}

const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function points(v: unknown): { x: number; y: number }[] {
  return arr(v).map((p) => {
    const o = obj(p);
    return { x: num(o.x), y: num(o.y) };
  });
}

/**
 * Parse and validate a venue file, defaulting missing fields the way
 * desktop `readVenueFile` does (enabled → true, numbers → 0). Throws with
 * a readable message for non-JSON, a foreign schema, or a file with
 * nothing venue-like in it.
 */
export function parseVenueFile(text: string): Venue {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error('not a JSON venue file');
  }
  const o = obj(root);
  if (o.schema !== undefined && !(typeof o.schema === 'string' && o.schema.startsWith('bld-venue/'))) {
    throw new Error(`unsupported venue schema: ${String(o.schema)}`);
  }
  if (!Array.isArray(o.edges) && !Array.isArray(o.obstacles) && o.bounds === undefined) {
    throw new Error('file has no venue outline, obstacles or bounds');
  }
  const b = obj(o.bounds);
  return {
    name: str(o.name),
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    minWalkwayStuds: num(o.minWalkwayStuds),
    bounds: { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) },
    edges: arr(o.edges).map((e) => {
      const eo = obj(e);
      const k = num(eo.kind);
      return {
        kind: (k === 1 || k === 2 ? k : 0) as EdgeKind,
        doorWidthStuds: num(eo.doorWidthStuds),
        label: str(eo.label),
        poly: points(eo.poly),
      };
    }),
    obstacles: arr(o.obstacles).map((ob) => {
      const oo = obj(ob);
      return { label: str(oo.label), poly: points(oo.poly) };
    }),
  };
}
