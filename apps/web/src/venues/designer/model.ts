// The Venue Designer's edits, as pure functions on a Venue (studs, x east,
// y south; references/VENUE-MODEL.md). Every tool and the inspector go
// through these, so they are tested once here, and the desktop's
// venue/DesignerModel.cpp does the same edits the same way.

import type {
  Venue,
  VenueDimension,
  VenueEdge,
  VenueNote,
  VenueObstacle,
  VenueObstacleKind,
  VenuePower,
} from '@cld/bbm';

export type Pt = { x: number; y: number };
type EdgeKind = Venue['edges'][number]['kind'];

/** What can be selected: a part of the venue and its index in its list. */
export type PartKind = 'edge' | 'obstacle' | 'power' | 'note' | 'dimension';
export interface Selection {
  kind: PartKind;
  index: number;
}

export function emptyVenue(name = 'New venue'): Venue {
  return { name, enabled: true, minWalkwayStuds: 112.5, bounds: { x: 0, y: 0, w: 0, h: 0 }, edges: [], obstacles: [] };
}

const withList = <K extends 'power' | 'notes' | 'dimensions'>(v: Venue, key: K, list: NonNullable<Venue[K]>): Venue => {
  const out = { ...v };
  if (list.length) (out as Record<string, unknown>)[key] = list;
  else delete (out as Record<string, unknown>)[key];
  return out;
};

// ---- adding -------------------------------------------------------------------

/** A wall (or door, or opening) along `points`. */
export function addEdge(v: Venue, points: Pt[], kind: EdgeKind = 0, label = ''): Venue {
  if (points.length < 2) return v;
  const edge: VenueEdge = { kind, doorWidthStuds: kind === 1 ? polylineLength(points) : 0, label, poly: points };
  return { ...v, edges: [...v.edges, edge] };
}

/** A rectangular room: four walls, one per side, clockwise from the north-west corner. */
export function addRoom(v: Venue, a: Pt, b: Pt): Venue {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return v;
  const c = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const sides = ['north wall', 'east wall', 'south wall', 'west wall'];
  let out = v;
  for (let i = 0; i < 4; i++) out = addEdge(out, [c[i]!, c[(i + 1) % 4]!], 0, sides[i]);
  return out;
}

/** An obstacle from two opposite corners (railings: from its two ends, `thickness` wide). */
export function addObstacle(v: Venue, kind: VenueObstacleKind | undefined, a: Pt, b: Pt, label = ''): Venue {
  let poly: Pt[];
  if (kind === 'railing') {
    poly = thickLine(a, b, RAILING_THICKNESS_STUDS);
    if (poly.length === 0) return v;
  } else {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 0.001 || y1 - y0 < 0.001) return v;
    poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  }
  const ob: VenueObstacle = { label: label || defaultLabel(kind), poly };
  if (kind) ob.kind = kind;
  if (kind === 'stairs') ob.upDegrees = 270;
  return { ...v, obstacles: [...v.obstacles, ob] };
}

export const RAILING_THICKNESS_STUDS = 4;

function defaultLabel(kind: VenueObstacleKind | undefined): string {
  switch (kind) {
    case 'column': return 'column';
    case 'stairs': return 'stairs';
    case 'elevator': return 'elevator';
    case 'counter': return 'counter';
    case 'railing': return 'railing';
    default: return 'obstacle';
  }
}

export function addPower(v: Venue, at: Pt, kind: 'wall' | 'floor'): Venue {
  const p: VenuePower = { x: at.x, y: at.y, kind };
  return withList(v, 'power', [...(v.power ?? []), p]);
}

export function addNote(v: Venue, at: Pt, text: string): Venue {
  if (!text.trim()) return v;
  const n: VenueNote = { x: at.x, y: at.y, text: text.trim() };
  return withList(v, 'notes', [...(v.notes ?? []), n]);
}

export function addDimension(v: Venue, from: Pt, to: Pt, label = ''): Venue {
  if (dist(from, to) < 0.001) return v;
  const d: VenueDimension = { from, to };
  if (label) d.label = label;
  return withList(v, 'dimensions', [...(v.dimensions ?? []), d]);
}

/**
 * Cut a door or opening into a wall: along segment `seg` of edge `edge`,
 * from `t0` to `t1` (0–1 along the segment). The wall is split into the
 * part before, the new door / opening, and the part after; the parts keep
 * the wall's label and estimated flag. Returns the venue unchanged when
 * the edge isn't a wall or the cut is empty.
 */
export function cutOpening(v: Venue, edge: number, seg: number, t0: number, t1: number, kind: 1 | 2, label = ''): Venue {
  const e = v.edges[edge];
  if (!e || e.kind !== 0 || seg < 0 || seg >= e.poly.length - 1) return v;
  const [lo, hi] = [Math.max(0, Math.min(t0, t1)), Math.min(1, Math.max(t0, t1))];
  const a = e.poly[seg]!, b = e.poly[seg + 1]!;
  const p0 = lerp(a, b, lo), p1 = lerp(a, b, hi);
  if (dist(p0, p1) < 0.001) return v;
  const keep = (poly: Pt[]): VenueEdge | null =>
    polylineLength(poly) < 0.001 ? null : { ...e, poly };
  const before = keep([...e.poly.slice(0, seg + 1), p0]);
  const after = keep([p1, ...e.poly.slice(seg + 1)]);
  const cut: VenueEdge = {
    kind,
    doorWidthStuds: kind === 1 ? dist(p0, p1) : 0,
    label,
    poly: [p0, p1],
    ...(e.estimated ? { estimated: true } : {}),
  };
  const replaced = [before, cut, after].filter((x): x is VenueEdge => x !== null);
  return { ...v, edges: [...v.edges.slice(0, edge), ...replaced, ...v.edges.slice(edge + 1)] };
}

// ---- changing ------------------------------------------------------------------

/** Merge `patch` into one part. */
export function updatePart(v: Venue, sel: Selection, patch: Record<string, unknown>): Venue {
  const apply = <T extends object>(list: T[]): T[] => list.map((x, i) => (i === sel.index ? dropUnset({ ...x, ...patch }) : x));
  switch (sel.kind) {
    case 'edge': return { ...v, edges: apply(v.edges) };
    case 'obstacle': return { ...v, obstacles: apply(v.obstacles) };
    case 'power': return withList(v, 'power', apply(v.power ?? []));
    case 'note': return withList(v, 'notes', apply(v.notes ?? []));
    case 'dimension': return withList(v, 'dimensions', apply(v.dimensions ?? []));
  }
}

// Optional fields set to undefined, false (estimated) or '' (label) are removed.
function dropUnset<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const [k, val] of Object.entries(out)) {
    if (val === undefined) delete out[k];
    if (k === 'estimated' && val === false) delete out[k];
  }
  return out as T;
}

/** Move one part by `d` (studs). */
export function movePart(v: Venue, sel: Selection, d: Pt): Venue {
  const mv = (p: Pt): Pt => ({ x: p.x + d.x, y: p.y + d.y });
  switch (sel.kind) {
    case 'edge': return updatePart(v, sel, { poly: v.edges[sel.index]!.poly.map(mv) });
    case 'obstacle': return updatePart(v, sel, { poly: v.obstacles[sel.index]!.poly.map(mv) });
    case 'power': {
      const p = v.power![sel.index]!;
      return updatePart(v, sel, mv(p));
    }
    case 'note': {
      const n = v.notes![sel.index]!;
      return updatePart(v, sel, mv(n));
    }
    case 'dimension': {
      const dd = v.dimensions![sel.index]!;
      return updatePart(v, sel, { from: mv(dd.from), to: mv(dd.to) });
    }
  }
}

/** Move one vertex of an edge or obstacle (or an end of a measurement: 0 = from, 1 = to). */
export function moveVertex(v: Venue, sel: Selection, vertex: number, to: Pt): Venue {
  if (sel.kind === 'edge' || sel.kind === 'obstacle') {
    const poly = (sel.kind === 'edge' ? v.edges[sel.index] : v.obstacles[sel.index])?.poly;
    if (!poly || vertex < 0 || vertex >= poly.length) return v;
    const next = poly.map((p, i) => (i === vertex ? to : p));
    const patch: Record<string, unknown> = { poly: next };
    if (sel.kind === 'edge' && v.edges[sel.index]!.kind === 1) patch.doorWidthStuds = polylineLength(next);
    return updatePart(v, sel, patch);
  }
  if (sel.kind === 'dimension') return updatePart(v, sel, vertex === 0 ? { from: to } : { to });
  return v;
}

/**
 * Move a corner of the outline: every edge vertex at `at` goes to `to`, so
 * walls that meet there stay joined.
 */
export function moveCorner(v: Venue, at: Pt, to: Pt): Venue {
  let changed = false;
  const edges = v.edges.map((e) => {
    if (!e.poly.some((p) => dist(p, at) < 0.001)) return e;
    changed = true;
    const poly = e.poly.map((p) => (dist(p, at) < 0.001 ? to : p));
    return e.kind === 1 ? { ...e, poly, doorWidthStuds: polylineLength(poly) } : { ...e, poly };
  });
  return changed ? { ...v, edges } : v;
}

/**
 * Resize a rectangular obstacle to `w` × `h` studs, keeping its north-west
 * corner (the inspector's Width and Depth).
 */
export function resizeObstacle(v: Venue, index: number, w: number, h: number): Venue {
  const ob = v.obstacles[index];
  if (!ob || w <= 0 || h <= 0) return v;
  const b = bbox(ob.poly);
  return updatePart(v, { kind: 'obstacle', index }, {
    poly: [{ x: b.x0, y: b.y0 }, { x: b.x0 + w, y: b.y0 }, { x: b.x0 + w, y: b.y0 + h }, { x: b.x0, y: b.y0 + h }],
  });
}

export function deletePart(v: Venue, sel: Selection): Venue {
  const drop = <T>(list: T[]): T[] => list.filter((_, i) => i !== sel.index);
  switch (sel.kind) {
    case 'edge': return { ...v, edges: drop(v.edges) };
    case 'obstacle': return { ...v, obstacles: drop(v.obstacles) };
    case 'power': return withList(v, 'power', drop(v.power ?? []));
    case 'note': return withList(v, 'notes', drop(v.notes ?? []));
    case 'dimension': return withList(v, 'dimensions', drop(v.dimensions ?? []));
  }
}

/** A copy of the part, 2 ft to the south-east; returns the venue and the copy's selection. */
export function duplicatePart(v: Venue, sel: Selection): { venue: Venue; selection: Selection } {
  const list = partList(v, sel.kind) as unknown[];
  const item = list[sel.index];
  if (item === undefined) return { venue: v, selection: sel };
  const appended: Venue = (() => {
    switch (sel.kind) {
      case 'edge': return { ...v, edges: [...v.edges, v.edges[sel.index]!] };
      case 'obstacle': return { ...v, obstacles: [...v.obstacles, v.obstacles[sel.index]!] };
      case 'power': return withList(v, 'power', [...v.power!, v.power![sel.index]!]);
      case 'note': return withList(v, 'notes', [...v.notes!, v.notes![sel.index]!]);
      case 'dimension': return withList(v, 'dimensions', [...v.dimensions!, v.dimensions![sel.index]!]);
    }
  })();
  const copy: Selection = { kind: sel.kind, index: list.length };
  const off = 24 * (38.09814081 / 12);
  return { venue: movePart(appended, copy, { x: off, y: off }), selection: copy };
}

// ---- looking ------------------------------------------------------------------

export function partList(v: Venue, kind: PartKind): readonly unknown[] {
  switch (kind) {
    case 'edge': return v.edges;
    case 'obstacle': return v.obstacles;
    case 'power': return v.power ?? [];
    case 'note': return v.notes ?? [];
    case 'dimension': return v.dimensions ?? [];
  }
}

/** Parts still marked estimated (the "N estimates left to measure" count). */
export function estimateCount(v: Venue): number {
  return (
    v.edges.filter((e) => e.estimated).length +
    (v.notes ?? []).filter((n) => n.estimated).length +
    (v.dimensions ?? []).filter((d) => d.estimated).length
  );
}

/** The outline's bounding box and the enclosed floor area (studs²), from the walls, doors and openings. */
export function roomSize(v: Venue): { w: number; h: number; area: number } | null {
  const pts = v.edges.flatMap((e) => e.poly);
  if (pts.length < 3) return null;
  const b = bbox(pts);
  // Area of the outline taken as one ring in edge order (the usual case: edges drawn around the room).
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return { w: b.x1 - b.x0, h: b.y1 - b.y0, area: Math.abs(a) / 2 };
}

/**
 * The part under `p` within `tol` studs, topmost first: notes, power,
 * measurements, obstacles (inside), then edges (near a segment). Also the
 * vertex under `p` when there is one.
 */
export function hitTest(v: Venue, p: Pt, tol: number): (Selection & { vertex?: number; seg?: number; t?: number }) | null {
  const notes = v.notes ?? [];
  for (let i = notes.length - 1; i >= 0; i--) if (dist(notes[i]!, p) <= tol * 2) return { kind: 'note', index: i };
  const power = v.power ?? [];
  for (let i = power.length - 1; i >= 0; i--) if (dist(power[i]!, p) <= Math.max(tol, 6)) return { kind: 'power', index: i };
  const dims = v.dimensions ?? [];
  for (let i = dims.length - 1; i >= 0; i--) {
    const d = dims[i]!;
    if (dist(d.from, p) <= tol) return { kind: 'dimension', index: i, vertex: 0 };
    if (dist(d.to, p) <= tol) return { kind: 'dimension', index: i, vertex: 1 };
    if (segDist(p, d.from, d.to).d <= tol) return { kind: 'dimension', index: i };
  }
  for (let i = v.obstacles.length - 1; i >= 0; i--) {
    const poly = v.obstacles[i]!.poly;
    const vi = poly.findIndex((q) => dist(q, p) <= tol);
    if (vi >= 0) return { kind: 'obstacle', index: i, vertex: vi };
    if (pointInPolygon(p, poly)) return { kind: 'obstacle', index: i };
  }
  for (let i = v.edges.length - 1; i >= 0; i--) {
    const poly = v.edges[i]!.poly;
    const vi = poly.findIndex((q) => dist(q, p) <= tol);
    if (vi >= 0) return { kind: 'edge', index: i, vertex: vi };
    for (let s = 0; s < poly.length - 1; s++) {
      const r = segDist(p, poly[s]!, poly[s + 1]!);
      if (r.d <= tol) return { kind: 'edge', index: i, seg: s, t: r.t };
    }
  }
  return null;
}

// ---- geometry -----------------------------------------------------------------

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function polylineLength(poly: Pt[]): number {
  let n = 0;
  for (let i = 1; i < poly.length; i++) n += dist(poly[i - 1]!, poly[i]!);
  return n;
}

export function bbox(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Distance from `p` to segment ab, and where along it (0–1) the nearest point is. */
export function segDist(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { d: dist(p, { x: a.x + dx * t, y: a.y + dy * t }), t };
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function thickLine(a: Pt, b: Pt, w: number): Pt[] {
  const len = dist(a, b);
  if (len < 0.001) return [];
  const nx = (-(b.y - a.y) / len) * (w / 2), ny = ((b.x - a.x) / len) * (w / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}
