// Venue validation and new-venue construction — port of the desktop's
// edit::validateVenue (VenueValidator.cpp:78-165), its status-bar readout
// (MainWindow.cpp:917-936) and MapView::finishVenueDraw
// (MapView.cpp:891-925). Pure: no React, no Yjs.

import type { BbmMap } from '@cld/model';
import type { Venue, VenueEdge, VenueObstacle } from '@cld/bbm';

type Pt = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

/** Default walkway buffer of a new venue: ~900 mm (core/Venue.h:35). */
export const DEFAULT_MIN_WALKWAY_STUDS = 112.5;

export type VenueViolationKind = 'outside' | 'walkway' | 'obstacle';

export interface VenueViolation {
  kind: VenueViolationKind;
  brickId: string;
  layerId: string;
  description: string;
}

/** Ray-casting point-in-polygon; the polygon is closed implicitly. */
export function pointInPolygon(poly: readonly Pt[], p: Pt): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const { x: xi, y: yi } = poly[i]!;
    const { x: xj, y: yj } = poly[j]!;
    const intersect = (yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Distance from `p` to the segment a–b. */
export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** The outline polygon walked from the edge polylines, consecutive duplicates dropped. */
export function outlinePolygon(venue: Pick<Venue, 'edges'>): Pt[] {
  const poly: Pt[] = [];
  const far = (a: Pt, b: Pt) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1e-6;
  for (const e of venue.edges) {
    for (const p of e.poly) if (poly.length === 0 || far(poly[poly.length - 1]!, p)) poly.push(p);
  }
  if (poly.length > 1 && !far(poly[0]!, poly[poly.length - 1]!)) poly.pop();
  return poly;
}

function corners(b: Box): Pt[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ];
}

/** Nearest distance from the brick's corners and centre to any Door/Open edge segment. */
function distanceToNonWallEdges(edges: readonly VenueEdge[], b: Box): number {
  const samples = [...corners(b), { x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  let best = Infinity;
  for (const e of edges) {
    if (e.kind === 0) continue;
    for (let i = 0; i + 1 < e.poly.length; i++) {
      for (const s of samples) best = Math.min(best, pointSegmentDistance(s, e.poly[i]!, e.poly[i + 1]!));
    }
  }
  return best;
}

/**
 * Every brick problem against an enabled venue: outside the outline
 * (skipping the other checks), within `minWalkwayStuds` of a door / open
 * edge, overlapping an obstacle. The outline and walkway checks need an
 * outline of 3+ points; obstacles are checked regardless. One entry per
 * brick per problem.
 */
export function validateVenue(venue: Venue | null | undefined, map: BbmMap | null | undefined): VenueViolation[] {
  const out: VenueViolation[] = [];
  if (!venue || !venue.enabled || !map) return out;
  const outline = outlinePolygon(venue);
  const haveOutline = outline.length >= 3;
  const minBuffer = venue.minWalkwayStuds;
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      const box = b.displayArea;
      const base = { brickId: b.id, layerId: layer.id };
      if (haveOutline && corners(box).some((c) => !pointInPolygon(outline, c))) {
        out.push({ ...base, kind: 'outside', description: 'Brick extends past the venue outline' });
        continue;
      }
      if (haveOutline && minBuffer > 0.01) {
        const d = distanceToNonWallEdges(venue.edges, box);
        if (d < minBuffer) {
          out.push({
            ...base,
            kind: 'walkway',
            description: `Brick is ${d.toFixed(1)} studs from a door/open edge (buffer ${minBuffer.toFixed(1)})`,
          });
        }
      }
      const hit = venue.obstacles.find((o) => corners(box).some((c) => pointInPolygon(o.poly, c)));
      if (hit) {
        out.push({
          ...base,
          kind: 'obstacle',
          description: hit.label ? `Brick overlaps venue obstacle '${hit.label}'` : 'Brick overlaps a venue obstacle',
        });
      }
    }
  }
  return out;
}

/**
 * Status-bar readout for the venue: null when there is no enabled venue
 * (the label is cleared), else "Venue: OK" or "Venue: N issue(s)" with a
 * bullet list of at most 12 problems as the tooltip.
 */
export function venueStatus(
  venue: Venue | null | undefined,
  violations: readonly VenueViolation[],
): { text: string; tooltip: string; ok: boolean } | null {
  if (!venue || !venue.enabled) return null;
  if (violations.length === 0) {
    return { text: 'Venue: OK', tooltip: 'No layout problems against the current venue', ok: true };
  }
  const lines: string[] = [];
  for (const v of violations) {
    lines.push(`• ${v.description}`);
    if (lines.length >= 12) { lines.push('…'); break; }
  }
  return { text: `Venue: ${violations.length} issue(s)`, tooltip: lines.join('\n'), ok: false };
}

/** A fresh venue with the desktop defaults (core/Venue.h). */
export function newVenue(): Venue {
  return {
    name: '',
    enabled: true,
    minWalkwayStuds: DEFAULT_MIN_WALKWAY_STUDS,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    edges: [],
    obstacles: [],
  };
}

export const VENUE_MIN_POINTS_MESSAGE = 'Venue polygon needs at least 3 points';

/**
 * The venue after finishing a drawn polygon, or null when it has fewer
 * than 3 points (desktop keeps the tool and says so). Drawing always
 * enables the venue. An outline replaces the edges with one edge per
 * side — Wall unless `metas` (Draw by Dimensions) gives its kind and
 * label (MainWindowMapMenu.cpp:173-194); an obstacle is appended.
 */
export function venueAfterDraw(
  existing: Venue | null | undefined,
  kind: 'outline' | 'obstacle',
  pts: readonly Pt[],
  metas: readonly { kind: VenueEdge['kind']; label: string }[] = [],
): Venue | null {
  if (pts.length < 3) return null;
  const base = existing ?? newVenue();
  if (kind === 'obstacle') {
    const obstacle: VenueObstacle = { label: '', poly: [...pts] };
    return { ...base, enabled: true, obstacles: [...base.obstacles, obstacle] };
  }
  const edges: VenueEdge[] = pts.map((pt, i) => ({
    kind: metas[i]?.kind ?? 0,
    doorWidthStuds: 0,
    label: metas[i]?.label ?? '',
    poly: [pt, pts[(i + 1) % pts.length]!],
  }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return {
    ...base,
    enabled: true,
    bounds: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY },
    edges,
  };
}
