// Venue validator / status / draw — port of VenueValidator.cpp:78-165,
// MainWindow.cpp:917-936 and MapView::finishVenueDraw (MapView.cpp:891-925).

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import type { Venue } from '@cld/bbm';
import {
  DEFAULT_MIN_WALKWAY_STUDS,
  newVenue,
  outlinePolygon,
  pointInPolygon,
  pointSegmentDistance,
  validateVenue,
  venueAfterDraw,
  venueStatus,
} from '../venueValidator';

const SQUARE = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

function venue(over: Partial<Venue> = {}): Venue {
  return { ...venueAfterDraw(null, 'outline', SQUARE)!, minWalkwayStuds: 0, ...over };
}

function map(...bricks: { id: string; x: number; y: number; w?: number; h?: number }[]): BbmMap {
  return {
    layers: [{
      type: 'brick', id: 'L1', visible: true,
      bricks: bricks.map((b) => ({ id: b.id, orientation: 0, displayArea: { x: b.x, y: b.y, width: b.w ?? 4, height: b.h ?? 4 } })),
    }],
  } as unknown as BbmMap;
}

describe('geometry helpers', () => {
  it('pointInPolygon / pointSegmentDistance', () => {
    expect(pointInPolygon(SQUARE, { x: 50, y: 50 })).toBe(true);
    expect(pointInPolygon(SQUARE, { x: 150, y: 50 })).toBe(false);
    expect(pointInPolygon(SQUARE.slice(0, 2), { x: 1, y: 0 })).toBe(false);
    expect(pointSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(pointSegmentDistance({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('walks the outline from the edge polylines without duplicates', () => {
    expect(outlinePolygon(venue())).toEqual(SQUARE);
  });
});

describe('validateVenue', () => {
  it('flags bricks past the outline and skips the other checks for them', () => {
    const v = venue({ minWalkwayStuds: 50, obstacles: [{ label: '', poly: [{ x: 90, y: 90 }, { x: 110, y: 90 }, { x: 110, y: 110 }, { x: 90, y: 110 }] }] });
    const out = validateVenue(v, map({ id: 'in', x: 40, y: 40 }, { id: 'out', x: 98, y: 98 }));
    expect(out).toEqual([{ kind: 'outside', brickId: 'out', layerId: 'L1', description: 'Brick extends past the venue outline' }]);
  });

  it('measures the walkway by distance to door/open edges, once per brick (regression: bbox, per-edge double count)', () => {
    const v = venue({ minWalkwayStuds: 20 });
    v.edges[0] = { ...v.edges[0]!, kind: 1 }; // top edge (0,0)-(100,0) is a door
    v.edges[1] = { ...v.edges[1]!, kind: 2 }; // right edge is open
    const out = validateVenue(v, map(
      { id: 'near', x: 90, y: 10 }, // near both the door and the open edge
      { id: 'far', x: 40, y: 40 },
      // Diagonal off the segment end: inside a bbox band, but 15+ studs away.
      { id: 'corner', x: 50, y: 50, w: 2, h: 2 },
    ));
    expect(out.map((o) => o.brickId)).toEqual(['near']);
    expect(out[0]!.description).toBe('Brick is 6.0 studs from a door/open edge (buffer 20.0)');
    // Walls never count.
    expect(validateVenue(venue({ minWalkwayStuds: 20 }), map({ id: 'near', x: 90, y: 10 }))).toEqual([]);
  });

  it('flags obstacle overlap, naming the obstacle; obstacles need no outline', () => {
    const obstacle = { label: 'Pillar', poly: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }] };
    const out = validateVenue({ ...newVenue(), minWalkwayStuds: 0, obstacles: [obstacle] }, map({ id: 'b', x: 18, y: 18 }, { id: 'ok', x: 30, y: 30 }));
    expect(out).toEqual([{ kind: 'obstacle', brickId: 'b', layerId: 'L1', description: "Brick overlaps venue obstacle 'Pillar'" }]);
    expect(validateVenue(venue({ obstacles: [{ ...obstacle, label: '' }] }), map({ id: 'b', x: 18, y: 18 }))[0]!.description)
      .toBe('Brick overlaps a venue obstacle');
  });

  it('requires an outline for the outside and walkway checks', () => {
    const noOutline = { ...newVenue(), edges: [] };
    expect(validateVenue(noOutline, map({ id: 'b', x: -500, y: -500 }))).toEqual([]);
  });

  it('is empty for a disabled or missing venue', () => {
    expect(validateVenue(venue({ enabled: false }), map({ id: 'x', x: 500, y: 500 }))).toEqual([]);
    expect(validateVenue(null, map())).toEqual([]);
  });
});

describe('venueStatus', () => {
  it('reads "Venue: OK" or "Venue: N issue(s)" with a capped bullet list', () => {
    expect(venueStatus(null, [])).toBeNull();
    expect(venueStatus(venue({ enabled: false }), [])).toBeNull();
    expect(venueStatus(venue(), [])).toEqual({ text: 'Venue: OK', tooltip: 'No layout problems against the current venue', ok: true });
    const many = Array.from({ length: 15 }, (_, i) => ({ kind: 'outside' as const, brickId: `${i}`, layerId: 'L', description: `d${i}` }));
    const s = venueStatus(venue(), many)!;
    expect(s.text).toBe('Venue: 15 issue(s)');
    const lines = s.tooltip.split('\n');
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe('• d0');
    expect(lines[12]).toBe('…');
  });
});

describe('venueAfterDraw / newVenue', () => {
  it('new venues default to a 112.5-stud walkway, enabled', () => {
    expect(DEFAULT_MIN_WALKWAY_STUDS).toBe(112.5);
    expect(newVenue()).toMatchObject({ enabled: true, minWalkwayStuds: 112.5, edges: [], obstacles: [] });
    expect(venueAfterDraw(null, 'outline', SQUARE)!.minWalkwayStuds).toBe(112.5);
  });

  it('needs at least 3 points', () => {
    expect(venueAfterDraw(null, 'outline', SQUARE.slice(0, 2))).toBeNull();
    expect(venueAfterDraw(venue(), 'obstacle', [])).toBeNull();
  });

  it('forces enabled when drawing, keeping the rest of the venue', () => {
    const disabled = venue({ enabled: false, name: 'Hall', minWalkwayStuds: 30 });
    const outline = venueAfterDraw(disabled, 'outline', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])!;
    expect(outline).toMatchObject({ enabled: true, name: 'Hall', minWalkwayStuds: 30, bounds: { x: 0, y: 0, w: 10, h: 10 } });
    expect(outline.edges).toHaveLength(3);
    expect(outline.edges[2]!.poly).toEqual([{ x: 0, y: 10 }, { x: 0, y: 0 }]);
    const withObstacle = venueAfterDraw(disabled, 'obstacle', SQUARE)!;
    expect(withObstacle.enabled).toBe(true);
    expect(withObstacle.edges).toEqual(disabled.edges);
    expect(withObstacle.obstacles).toHaveLength(1);
  });

  it('takes edge kinds and labels from Draw by Dimensions', () => {
    const v = venueAfterDraw(null, 'outline', SQUARE, [{ kind: 1, label: 'Door A' }])!;
    expect(v.edges[0]).toMatchObject({ kind: 1, label: 'Door A' });
    expect(v.edges[1]).toMatchObject({ kind: 0, label: '' });
  });
});
