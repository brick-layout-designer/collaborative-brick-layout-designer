// The Venue Designer's core: typed lengths, the venue edits every tool uses,
// snapping and undo. The desktop's DesignerCoreTest checks the same cases.

import { describe, expect, it } from 'vitest';
import { formatLength, parseLength, STUDS_PER_INCH } from '../units';
import {
  addDimension,
  addEdge,
  addNote,
  addObstacle,
  addPower,
  addRoom,
  cutOpening,
  deletePart,
  duplicatePart,
  emptyVenue,
  estimateCount,
  hitTest,
  movePart,
  moveVertex,
  resizeObstacle,
  roomSize,
  updatePart,
} from '../model';
import { pointAtLength, snapPoint } from '../snap';
import { commit, redo, startHistory, undo } from '../history';

const IN = STUDS_PER_INCH;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('typed lengths', () => {
  it.each([
    ["12'6\"", 150],
    ["12' 6\"", 150],
    ['12′ 6″', 150],
    ["40' 4\"", 484],
    ['12ft 6in', 150],
    ["12.5'", 150],
    ['6"', 6],
    ['6 1/2"', 6.5],
    ["12' 6 1/2\"", 150.5],
    ["12'6", 150],
    ['129', 129],
    ['74.5', 74.5],
    ['12 feet', 144],
  ])('%s is %f inches', (text, inches) => {
    near(parseLength(text)!, inches * IN);
  });

  it('reads metric and studs, and bare numbers in the current unit', () => {
    near(parseLength('3.2m')!, 400);
    near(parseLength('320cm')!, 400);
    near(parseLength('3200 mm')!, 400);
    near(parseLength('80 studs')!, 80);
    near(parseLength('2', 'm')!, 250);
    near(parseLength('80', 'studs')!, 80);
  });

  it('refuses what is not a length', () => {
    for (const bad of ['', 'abc', "12'6'", '1/0"', '-3', '12 bananas']) expect(parseLength(bad)).toBeNull();
  });

  it('shows feet and inches to the quarter inch, and metric and studs', () => {
    expect(formatLength(150 * IN)).toBe('12′ 6″');
    expect(formatLength(484 * IN)).toBe('40′ 4″');
    expect(formatLength(6.5 * IN)).toBe('6½″');
    expect(formatLength(946.6 * IN)).toBe('78′ 10½″');
    expect(formatLength(12 * IN - 0.01)).toBe('1′ 0″');
    expect(formatLength(400, 'm')).toBe('3.20 m');
    expect(formatLength(145.26, 'studs')).toBe('145.3 studs');
  });
});

describe('venue edits', () => {
  it('draws a room as four labelled walls, clockwise', () => {
    const v = addRoom(emptyVenue(), { x: 100, y: 50 }, { x: 0, y: 0 });
    expect(v.edges.map((e) => e.label)).toEqual(['north wall', 'east wall', 'south wall', 'west wall']);
    expect(v.edges[0]!.poly).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(v.edges.every((e) => e.kind === 0)).toBe(true);
    expect(roomSize(v)).toEqual({ w: 100, h: 50, area: 5000 });
    expect(addRoom(emptyVenue(), { x: 0, y: 0 }, { x: 0, y: 10 }).edges).toHaveLength(0);
  });

  it('cuts a door or an opening into a wall, keeping both wall parts', () => {
    let v = addEdge(emptyVenue(), [{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, 'south wall');
    v = updatePart(v, { kind: 'edge', index: 0 }, { estimated: true });
    const cut = cutOpening(v, 0, 0, 0.6, 0.2, 1, 'main door');
    expect(cut.edges.map((e) => [e.kind, e.label, e.poly.map((p) => p.x)])).toEqual([
      [0, 'south wall', [0, 20]],
      [1, 'main door', [20, 60]],
      [0, 'south wall', [60, 100]],
    ]);
    near(cut.edges[1]!.doorWidthStuds, 40);
    expect(cut.edges.every((e) => e.estimated)).toBe(true);
    // A cut to the end leaves no empty wall part.
    expect(cutOpening(v, 0, 0, 0.5, 1, 2).edges.map((e) => e.kind)).toEqual([0, 2]);
    // Only walls can be cut.
    expect(cutOpening(cut, 1, 0, 0.1, 0.2, 2)).toBe(cut);
  });

  it('adds obstacles of each kind; stairs go up to the north and railings are thin', () => {
    let v = addObstacle(emptyVenue(), 'stairs', { x: 10, y: 0 }, { x: 0, y: 20 });
    expect(v.obstacles[0]).toEqual({
      label: 'stairs',
      kind: 'stairs',
      upDegrees: 270,
      poly: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }, { x: 0, y: 20 }],
    });
    v = addObstacle(v, 'railing', { x: 0, y: 0 }, { x: 0, y: 30 });
    const r = v.obstacles[1]!.poly;
    expect(Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x))).toBeCloseTo(4);
    v = addObstacle(v, undefined, { x: 0, y: 0 }, { x: 5, y: 5 });
    expect(v.obstacles[2]!.kind).toBeUndefined();
    v = resizeObstacle(v, 0, 20 * 12 * IN, 15 * 12 * IN);
    near(v.obstacles[0]!.poly[2]!.x, 240 * IN);
    near(v.obstacles[0]!.poly[2]!.y, 180 * IN);
  });

  it('adds power, notes and measurements, and drops their lists when emptied', () => {
    let v = addPower(emptyVenue(), { x: 1, y: 2 }, 'floor');
    v = addNote(v, { x: 3, y: 4 }, '  Concessions upstairs ');
    v = addNote(v, { x: 3, y: 4 }, '   ');
    v = addDimension(v, { x: 0, y: 0 }, { x: 10, y: 0 }, "40' 4\"");
    expect(v.power).toEqual([{ x: 1, y: 2, kind: 'floor' }]);
    expect(v.notes).toEqual([{ x: 3, y: 4, text: 'Concessions upstairs' }]);
    expect(v.dimensions).toEqual([{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, label: "40' 4\"" }]);
    v = deletePart(v, { kind: 'power', index: 0 });
    expect('power' in v).toBe(false);
  });

  it('moves parts and vertices, updates and duplicates them, and counts estimates', () => {
    let v = addRoom(emptyVenue(), { x: 0, y: 0 }, { x: 100, y: 50 });
    v = moveVertex(v, { kind: 'edge', index: 0 }, 1, { x: 120, y: 0 });
    expect(v.edges[0]!.poly[1]).toEqual({ x: 120, y: 0 });
    v = addDimension(v, { x: 0, y: 0 }, { x: 10, y: 0 });
    v = moveVertex(v, { kind: 'dimension', index: 0 }, 1, { x: 30, y: 0 });
    expect(v.dimensions![0]!.to).toEqual({ x: 30, y: 0 });
    v = movePart(v, { kind: 'dimension', index: 0 }, { x: 0, y: 5 });
    expect(v.dimensions![0]).toEqual({ from: { x: 0, y: 5 }, to: { x: 30, y: 5 } });
    v = updatePart(v, { kind: 'dimension', index: 0 }, { estimated: true, label: '≈ 57′' });
    v = updatePart(v, { kind: 'edge', index: 2 }, { estimated: true });
    expect(estimateCount(v)).toBe(2);
    v = updatePart(v, { kind: 'edge', index: 2 }, { estimated: false });
    expect('estimated' in v.edges[2]!).toBe(false);
    const d = duplicatePart(v, { kind: 'dimension', index: 0 });
    expect(d.selection).toEqual({ kind: 'dimension', index: 1 });
    expect(d.venue.dimensions![1]!.from.x).toBeGreaterThan(0);
  });

  it('hits the topmost part under the pointer, and its corners', () => {
    let v = addRoom(emptyVenue(), { x: 0, y: 0 }, { x: 100, y: 50 });
    v = addObstacle(v, 'column', { x: 30, y: 10 }, { x: 60, y: 40 });
    v = addPower(v, { x: 45, y: 25 }, 'floor');
    expect(hitTest(v, { x: 45, y: 25 }, 2)).toEqual({ kind: 'power', index: 0 });
    expect(hitTest(v, { x: 33, y: 37 }, 1)).toEqual({ kind: 'obstacle', index: 0 });
    expect(hitTest(v, { x: 30.5, y: 10.5 }, 1)).toEqual({ kind: 'obstacle', index: 0, vertex: 0 });
    expect(hitTest(v, { x: 50, y: 0.5 }, 1)).toMatchObject({ kind: 'edge', index: 0, seg: 0 });
    expect(hitTest(v, { x: 100, y: 0.2 }, 1)).toMatchObject({ kind: 'edge', vertex: expect.any(Number) });
    expect(hitTest(v, { x: 80, y: 45 }, 1)).toBeNull();
  });
});

describe('snapping', () => {
  const v = addRoom(emptyVenue(), { x: 0, y: 0 }, { x: 100, y: 50 });
  const opts = { stepStuds: IN, angleStepDeg: 45, tolStuds: 3, toVenue: true };

  it('prefers corners, then the angle from the last point, then walls, then the grid', () => {
    expect(snapPoint(v, { x: 101, y: 1 }, opts)).toEqual({ pt: { x: 100, y: 0 }, kind: 'corner' });
    const a = snapPoint(v, { x: 30, y: 20.4 }, { ...opts, from: { x: 10, y: 20 } });
    expect(a.kind).toBe('angle');
    near(a.pt.y, 20);
    near(a.pt.x, 10 + Math.round(20 / IN) * IN);
    const w = snapPoint(v, { x: 30, y: 1 }, opts);
    expect(w.kind).toBe('wall');
    near(w.pt.y, 0);
    near(w.pt.x, Math.round(30 / IN) * IN);
    const g = snapPoint(v, { x: 30.3, y: 20.3 }, opts);
    expect(g.kind).toBe('grid');
    near(g.pt.x, Math.round(30.3 / IN) * IN);
    expect(snapPoint(v, { x: 30.3, y: 20.3 }, { ...opts, stepStuds: 0, toVenue: false }).kind).toBe('none');
  });

  it('puts a typed length along the snapped direction', () => {
    const p = pointAtLength({ x: 0, y: 0 }, { x: 10, y: 1 }, 50, 45);
    near(p.x, 50);
    near(p.y, 0);
    const q = pointAtLength({ x: 0, y: 0 }, { x: 10, y: -9 }, 10, 45);
    near(q.x, Math.SQRT1_2 * 10);
    near(q.y, -Math.SQRT1_2 * 10);
  });
});

describe('undo', () => {
  it('steps back and forward, and a new edit clears what was undone', () => {
    let h = startHistory(emptyVenue());
    const a = addPower(h.present, { x: 1, y: 1 }, 'wall');
    h = commit(h, a);
    h = commit(h, addPower(a, { x: 2, y: 2 }, 'wall'));
    expect(h.present.power).toHaveLength(2);
    h = undo(h);
    expect(h.present).toBe(a);
    h = redo(h);
    expect(h.present.power).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present.power).toBeUndefined();
    h = commit(h, addNote(h.present, { x: 0, y: 0 }, 'n'));
    expect(h.future).toEqual([]);
    expect(commit(h, h.present)).toBe(h);
  });
});
