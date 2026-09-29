// Venue files — port of desktop saveload/VenueIO.cpp. Desktop writes
// `*.bld-venue` JSON tagged `"schema": "bld-venue/1"`; older web builds
// wrote the bare Venue object as `*.cld-venue`. Both are read; files are
// written in the desktop format so they open in either app.
//
// The model is references/VENUE-MODEL.md: optional fields are written only
// when set, and fields this build doesn't know are kept, at every level.

import type {
  Venue,
  VenueDimension,
  VenueEdge,
  VenueNote,
  VenueObstacle,
  VenueObstacleKind,
  VenuePower,
} from '@cld/bbm';

type EdgeKind = Venue['edges'][number]['kind'];
type Pt = { x: number; y: number };

export const VENUE_SCHEMA = 'bld-venue/1';
export const VENUE_FILE_EXT = '.bld-venue';
export const VENUE_FILE_ACCEPT = '.bld-venue,.cld-venue,.json';

const OBSTACLE_KINDS: readonly VenueObstacleKind[] = ['column', 'stairs', 'elevator', 'counter', 'railing'];

const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const pt = (v: unknown): Pt => {
  const o = obj(v);
  return { x: num(o.x), y: num(o.y) };
};
const points = (v: unknown): Pt[] => arr(v).map(pt);

/** The keys of `o` not in `known`, to carry through unchanged. */
function extras(o: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!known.includes(k)) out[k] = v;
  return out;
}

// ---- normalise (read) --------------------------------------------------------

function edgeOf(e: unknown): VenueEdge {
  const o = obj(e);
  const k = num(o.kind);
  return {
    ...extras(o, ['kind', 'doorWidthStuds', 'label', 'poly', 'estimated']),
    kind: (k === 1 || k === 2 ? k : 0) as EdgeKind,
    doorWidthStuds: num(o.doorWidthStuds),
    label: str(o.label),
    poly: points(o.poly),
    ...(o.estimated === true ? { estimated: true } : {}),
  };
}

function obstacleOf(v: unknown): VenueObstacle {
  const o = obj(v);
  const kind = OBSTACLE_KINDS.find((k) => k === o.kind);
  return {
    ...extras(o, ['label', 'poly', 'kind', 'upDegrees']),
    label: str(o.label),
    poly: points(o.poly),
    ...(kind ? { kind } : {}),
    ...(typeof o.upDegrees === 'number' && Number.isFinite(o.upDegrees) ? { upDegrees: o.upDegrees } : {}),
  };
}

function powerOf(v: unknown): VenuePower {
  const o = obj(v);
  return {
    ...extras(o, ['x', 'y', 'kind', 'label', 'amps', 'volts']),
    x: num(o.x),
    y: num(o.y),
    kind: o.kind === 'floor' ? 'floor' : 'wall',
    ...(str(o.label) ? { label: str(o.label) } : {}),
    ...(num(o.amps) > 0 ? { amps: num(o.amps) } : {}),
    ...(num(o.volts) > 0 ? { volts: num(o.volts) } : {}),
  };
}

function noteOf(v: unknown): VenueNote {
  const o = obj(v);
  return {
    ...extras(o, ['x', 'y', 'text', 'estimated']),
    x: num(o.x),
    y: num(o.y),
    text: str(o.text),
    ...(o.estimated === true ? { estimated: true } : {}),
  };
}

function dimensionOf(v: unknown): VenueDimension {
  const o = obj(v);
  return {
    ...extras(o, ['from', 'to', 'label', 'estimated']),
    from: pt(o.from),
    to: pt(o.to),
    ...(str(o.label) ? { label: str(o.label) } : {}),
    ...(o.estimated === true ? { estimated: true } : {}),
  };
}

const VENUE_KEYS = [
  'schema',
  'name',
  'enabled',
  'minWalkwayStuds',
  'bounds',
  'edges',
  'obstacles',
  'power',
  'notes',
  'dimensions',
] as const;

/** A venue in canonical form from any venue-shaped JSON value. */
export function normalizeVenue(root: unknown): Venue {
  const o = obj(root);
  const b = obj(o.bounds);
  const power = arr(o.power).map(powerOf);
  const notes = arr(o.notes).map(noteOf);
  const dimensions = arr(o.dimensions).map(dimensionOf);
  return {
    ...extras(o, VENUE_KEYS),
    name: str(o.name),
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    minWalkwayStuds: num(o.minWalkwayStuds),
    bounds: { x: num(b.x), y: num(b.y), w: num(b.w), h: num(b.h) },
    edges: arr(o.edges).map(edgeOf),
    obstacles: arr(o.obstacles).map(obstacleOf),
    ...(power.length ? { power } : {}),
    ...(notes.length ? { notes } : {}),
    ...(dimensions.length ? { dimensions } : {}),
  };
}

export function writeVenueFile(v: Venue): string {
  return `${JSON.stringify({ schema: VENUE_SCHEMA, ...normalizeVenue(v) }, null, 4)}\n`;
}

/**
 * Parse a venue file, filling defaults for missing fields the way the
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
  return normalizeVenue(o);
}
