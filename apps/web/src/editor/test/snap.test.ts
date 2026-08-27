import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import type { PartWire } from '../../api';
import {
  connectionSnapReach,
  liveDragSnap,
  snapPlacement,
  snapToAnchorBrick,
  type PlaceCandidate,
} from '../snap';

// ---- helpers ---------------------------------------------------------------

function makePart(overrides: Partial<PartWire> = {}): PartWire {
  return {
    key: 'test.0',
    partNumber: 'TEST',
    colorCode: '0',
    kind: 'leaf',
    description: 'test part',
    sortingKey: '0',
    spritePath: '',
    pxPerStud: 32,
    category: 'test',
    connections: [],
    subparts: [],
    hullPts: [],
    source: 'bundled',
    customPartId: null,
    ...overrides,
  };
}

function makeBrick(overrides: {
  id?: string;
  partNumber?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  orientation?: number;
  connexions?: import('@cld/model').Connexion[];
  activeConnectionPointIndex?: number;
} = {}): import('@cld/model').Brick {
  return {
    id: overrides.id ?? 'b1',
    partNumber: overrides.partNumber ?? 'TEST',
    altitude: 0,
    orientation: overrides.orientation ?? 0,
    activeConnectionPointIndex: overrides.activeConnectionPointIndex ?? 0,
    connexions: overrides.connexions ?? [],
    displayArea: {
      x: overrides.x ?? 0,
      y: overrides.y ?? 0,
      width: overrides.w ?? 8,
      height: overrides.h ?? 8,
    },
    myGroup: '',
  };
}

const HULL: import('@cld/model').HullProperties = {
  isVisible: false,
  hullColor: { kind: 'argb', argb: '00000000' },
  hullThickness: 0,
};

function emptyMap(): BbmMap {
  return { layers: [] } as unknown as BbmMap;
}

function brickLayerMap(bricks: import('@cld/model').Brick[]): BbmMap {
  return {
    layers: [{
      type: 'brick',
      id: 'L1',
      name: 'Layer 1',
      visible: true,
      transparency: 0,
      hullProperties: HULL,
      displayBrickElevation: false,
      bricks,
      groups: [],
    }],
  } as unknown as BbmMap;
}

// ---- connectionSnapReach ---------------------------------------------------

describe('connectionSnapReach', () => {
  it('returns step + 2 when step > 0', () => {
    expect(connectionSnapReach(1)).toBe(3);
    expect(connectionSnapReach(8)).toBe(10);
    expect(connectionSnapReach(32)).toBe(34);
  });

  it('returns 4 as fallback when step is 0', () => {
    expect(connectionSnapReach(0)).toBe(4);
  });
});

// ---- snapPlacement — grid snap --------------------------------------------

describe('snapPlacement — grid snap', () => {
  const partsByKey = new Map<string, PartWire>([['test.0', makePart()]]);

  it('snaps top-left corner to nearest grid step and re-derives centre', () => {
    const candidate: PlaceCandidate = {
      part: makePart(),
      centreX: 3.7,   // TL = 3.7 - 4 = -0.3, nearest step-1 = 0, centre = 4
      centreY: 10.2,  // TL = 10.2 - 4 = 6.2, nearest step-1 = 6, centre = 10
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 1,
    };
    const result = snapPlacement(candidate, emptyMap(), partsByKey);
    expect(result.snappedToConnection).toBe(false);
    expect(result.newOrientation).toBeNull();
    expect(result.centreX).toBeCloseTo(4);
    expect(result.centreY).toBeCloseTo(10);
  });

  it('passes through unchanged when snap step is 0', () => {
    const candidate: PlaceCandidate = {
      part: makePart(),
      centreX: 3.7,
      centreY: 5.9,
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 0,
    };
    const result = snapPlacement(candidate, emptyMap(), partsByKey);
    expect(result.centreX).toBe(3.7);
    expect(result.centreY).toBe(5.9);
  });

  it('snaps on a larger step', () => {
    const candidate: PlaceCandidate = {
      part: makePart(),
      centreX: 19,  // TL = 19 - 4 = 15, nearest step-8 = 16, centre = 20
      centreY: 36,  // TL = 36 - 4 = 32, nearest step-8 = 32, centre = 36
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 8,
    };
    const result = snapPlacement(candidate, emptyMap(), partsByKey);
    expect(result.centreX).toBeCloseTo(20);
    expect(result.centreY).toBeCloseTo(36);
  });
});

// ---- snapPlacement — connection snap --------------------------------------

describe('snapPlacement — connection snap', () => {
  it('snaps to a nearby free connection on an existing brick', () => {
    const partWithConn = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    // Anchor brick: centre at (0, 0), connection at (4, 0) world.
    const anchor = makeBrick({ x: -4, y: -4, w: 8, h: 8, orientation: 0 });
    const partsByKey = new Map<string, PartWire>([['test.0', partWithConn]]);
    const map = brickLayerMap([anchor]);

    // Candidate: part with a female conn at (-4, 0) — currently near (4, 0).
    const newPart = makePart({
      connections: [{ type: 'male', x: -4, y: 0, angle: 180, electricPlug: 0 }],
    });
    const candidate: PlaceCandidate = {
      part: newPart,
      centreX: 7,
      centreY: 0,
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 1,
    };
    const result = snapPlacement(candidate, map, partsByKey);
    expect(result.snappedToConnection).toBe(true);
    // New centre must place the new brick's conn exactly on anchor's conn.
    expect(result.centreX).toBeCloseTo(8); // 4 (anchor conn) - (-4) (new conn local)
    expect(result.centreY).toBeCloseTo(0);
  });

  it('does NOT snap when existing connection is already linked', () => {
    const partWithConn = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    // Anchor brick with the connection already linked.
    const anchor = makeBrick({
      x: -4, y: -4, w: 8, h: 8,
      connexions: [{ id: 'cx1', linkedTo: 'someOtherBrick' }],
    });
    const partsByKey = new Map<string, PartWire>([['test.0', partWithConn]]);
    const map = brickLayerMap([anchor]);

    const newPart = makePart({
      connections: [{ type: 'male', x: -4, y: 0, angle: 180, electricPlug: 0 }],
    });
    const candidate: PlaceCandidate = {
      part: newPart,
      centreX: 8,
      centreY: 0,
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 1,
    };
    const result = snapPlacement(candidate, map, partsByKey);
    // Linked conn must be ignored — falls back to grid snap.
    expect(result.snappedToConnection).toBe(false);
  });

  it('returns unsnapped position when part has no connections', () => {
    const partsByKey = new Map<string, PartWire>([['test.0', makePart()]]);
    const candidate: PlaceCandidate = {
      part: makePart(),
      centreX: 5.5,
      centreY: 5.5,
      orientation: 0,
      width: 8,
      height: 8,
      snapStepStuds: 1,
    };
    const result = snapPlacement(candidate, emptyMap(), partsByKey);
    // Falls through to grid snap, no connection snap possible.
    expect(result.snappedToConnection).toBe(false);
  });
});

// ---- snapToAnchorBrick ----------------------------------------------------

describe('snapToAnchorBrick', () => {
  it('returns null when the new part has no connections', () => {
    const anchor = makeBrick();
    const anchorMeta = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const newPart = makePart(); // no connections
    expect(snapToAnchorBrick(anchor, anchorMeta, newPart, 8, 8)).toBeNull();
  });

  it('returns null when anchor has no compatible connection type', () => {
    const anchor = makeBrick({ connexions: [] });
    const anchorMeta = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const newPart = makePart({
      connections: [{ type: 'female', x: -4, y: 0, angle: 180, electricPlug: 0 }],
    });
    // 'male' ≠ 'female', so no snap.
    expect(snapToAnchorBrick(anchor, anchorMeta, newPart, 8, 8)).toBeNull();
  });

  it('returns a snap result when types match', () => {
    const anchor = makeBrick({ x: 0, y: 0, w: 8, h: 8, orientation: 0, connexions: [] });
    const anchorMeta = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const newPart = makePart({
      connections: [{ type: 'male', x: -4, y: 0, angle: 180, electricPlug: 0 }],
    });
    const result = snapToAnchorBrick(anchor, anchorMeta, newPart, 8, 8);
    expect(result).not.toBeNull();
    expect(result!.snappedToConnection).toBe(true);
    // Anchor brick at displayArea (0,0,8,8) → centre (4,4).
    // Anchor conn at (+4, 0) from centre → world (8, 4).
    // newOrient = targetAngle+180-nc.angle = (0+0)+180-180 = 0°.
    // rotate(nc.local=(-4,0), orient=0°) = (-4, 0).
    // new centre = anchorCP - rotated nc = (8,4) - (-4,0) = (12, 4).
    expect(result!.centreX).toBeCloseTo(12);
    expect(result!.centreY).toBeCloseTo(4);
  });

  it('skips already-linked connections when connexions data exists', () => {
    const anchor = makeBrick({
      x: 0, y: 0, w: 8, h: 8, orientation: 0,
      connexions: [{ id: 'cx2', linkedTo: 'taken' }],
    });
    const anchorMeta = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const newPart = makePart({
      connections: [{ type: 'male', x: -4, y: 0, angle: 180, electricPlug: 0 }],
    });
    // The only connection is already linked, so snap should fail.
    expect(snapToAnchorBrick(anchor, anchorMeta, newPart, 8, 8)).toBeNull();
  });
});

// ---- liveDragSnap ---------------------------------------------------------

describe('liveDragSnap', () => {
  it('returns grid-snapped position when map is empty', () => {
    const part = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const partsByKey = new Map<string, PartWire>([['test.0', part]]);
    const result = liveDragSnap(
      {
        part,
        movingId: 'drag1',
        movingLinks: [],
        centreX: 3.3,
        centreY: 7.8,
        mouseStudX: 3,
        mouseStudY: 7,
        orientation: 0,
        snapStepStuds: 1,
      },
      emptyMap(),
      partsByKey,
    );
    expect(result.snappedToConnection).toBe(false);
    expect(result.centreX).toBeCloseTo(3);
    expect(result.centreY).toBeCloseTo(8);
  });

  it('excludes the moving brick from target connections', () => {
    const part = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const dragged = makeBrick({ id: 'drag1', x: 0, y: 0, w: 8, h: 8 });
    const partsByKey = new Map<string, PartWire>([
      ['test.0', part],
      ['drag1', part],
    ]);
    // Only the dragged brick is in the map — it should not snap to itself.
    const map = brickLayerMap([dragged]);
    const result = liveDragSnap(
      {
        part,
        movingId: 'drag1',
        movingLinks: [],
        centreX: 4,
        centreY: 4,
        mouseStudX: 4,
        mouseStudY: 4,
        orientation: 0,
        snapStepStuds: 0,
      },
      map,
      partsByKey,
    );
    expect(result.snappedToConnection).toBe(false);
  });

  it('snaps to a compatible connection on a nearby stationary brick', () => {
    const part = makePart({
      connections: [{ type: 'male', x: 4, y: 0, angle: 0, electricPlug: 0 }],
    });
    const stationary = makeBrick({ id: 'static1', x: 8, y: 0, w: 8, h: 8 }); // centre (12, 4)
    const partsByKey = new Map<string, PartWire>([['test.0', part]]);
    const map = brickLayerMap([stationary]);
    // Dragged brick centre at (7, 4) — its conn is at (7+4, 4) = (11, 4).
    // Stationary conn is at (12+4, 4) = (16, 4)… actually (12-4, 4) = (8, 4)
    // because angle=0 means CP is at (+4, 0) from centre.
    // Actually stationary centre = (8 + 4, 0 + 4) = (12, 4), conn at (12+4, 4) = (16, 4).
    // Dragged centre (7, 4), conn at (7+4, 4) = (11, 4). Distance = 5 studs.
    // With reach = 3 (step 1 + 2), 5 > 3, so NO snap.
    // Move dragged to (11, 4) → conn at (15, 4), distance to (16, 4) = 1 → snap.
    const result = liveDragSnap(
      {
        part,
        movingId: 'drag1',
        movingLinks: [],
        centreX: 11,
        centreY: 4,
        mouseStudX: 11,
        mouseStudY: 4,
        orientation: 0,
        snapStepStuds: 1,
      },
      map,
      partsByKey,
    );
    expect(result.snappedToConnection).toBe(true);
    expect(result.ringStudX).not.toBeNull();
    expect(result.ringStudY).not.toBeNull();
  });

  it('passes through unsnapped when step is 0 and no connections match', () => {
    const part = makePart();
    const partsByKey = new Map<string, PartWire>([['test.0', part]]);
    const result = liveDragSnap(
      {
        part,
        movingId: 'drag1',
        movingLinks: [],
        centreX: 3.14,
        centreY: 2.71,
        mouseStudX: 3,
        mouseStudY: 2,
        orientation: 0,
        snapStepStuds: 0,
      },
      emptyMap(),
      partsByKey,
    );
    expect(result.centreX).toBe(3.14);
    expect(result.centreY).toBe(2.71);
    expect(result.snappedToConnection).toBe(false);
  });
});
