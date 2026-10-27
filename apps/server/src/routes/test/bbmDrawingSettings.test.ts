// A layout made from a .bbm file holds only drawing settings both apps
// draw: one out of range is put back in range (@cld/ydoc drawnLimits.ts),
// never refused, so the layout opens and every edit to it is taken by the
// live route's guard (ws/gridGuard.ts).

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import * as Y from 'yjs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';
import { DRAWN_LIMITS } from '@cld/ydoc';
import { checkGridSizes, drawingProblems } from '../../ws/gridGuard.js';
import { RULER_RULES, SHEET_RULES } from '../../ws/drawingSettings.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../packages/bbm/tests/fixtures');
const fordyce = readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf8');

/** The file with the first `<tag>…</tag>` holding `value`. */
const swap = (bbm: string, tag: string, value: string) => {
  const re = new RegExp(`<${tag}>[^<]*</${tag}>`);
  expect(bbm).toMatch(re);
  return bbm.replace(re, `<${tag}>${value}</${tag}>`);
};

describe('a layout made from a .bbm', () => {
  let app: FastifyInstance;
  let owner: { cookie: string; id: string };
  beforeEach(async () => {
    resetDb();
    app = Fastify({ logger: false });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(layoutRoutes);
    owner = await loginAs(app, 'bbm@x.com');
  });
  afterEach(async () => {
    await app.close();
  });

  const create = async (bbm: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: owner.cookie }, payload: { title: 't', bbm } });
    expect(res.statusCode, res.body).toBe(201);
    const row = db.select({ s: schema.layouts.docSnapshot }).from(schema.layouts).where(eq(schema.layouts.id, res.json().id)).get()!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.s as Uint8Array);
    return { doc, snapshot: row.s as Uint8Array };
  };
  const sheet = (doc: Y.Doc, type: string) => [...doc.getMap<Y.Map<unknown>>('layerData').values()].find((l) => l.get('type') === type)!;

  it.each([
    ['a grid with a million sub-divisions', 'SubDivisionNumber', '1000000', 'subDivisionNumber', 100],
    ['a grid with no sub-divisions', 'SubDivisionNumber', '0', 'subDivisionNumber', 2],
    ['grid lines a million studs thick', 'GridThickness', '1000000', 'gridThickness', 100],
    ['sub-grid lines thinner than nothing', 'SubGridThickness', '-7.5', 'subGridThickness', 0],
    ['a transparency of 500', 'Transparency', '500', 'transparency', 100],
    ['a grid cell size of minus 3', 'GridSizeInStud', '-3', 'gridSizeInStud', 1],
  ])('opens with %s, put back in range', async (_what, tag, value, field, expected) => {
    const { doc, snapshot } = await create(swap(fordyce, tag, value));
    expect(sheet(doc, 'grid').get(field)).toBe(expected);
    expect([...drawingProblems(doc)]).toEqual([]);
    // The whole layout is one the live route takes.
    expect(checkGridSizes(null, snapshot)).toBeNull();
  });

  it('opens with a ruler far out of range, put back in range', async () => {
    let bbm = swap(fordyce, 'LineThickness', '1e9');
    bbm = swap(bbm, 'Unit', '77');
    bbm = bbm.replace(/<GuidelineDashPattern>[\s\S]*?<\/GuidelineDashPattern>/, '<GuidelineDashPattern><value>0</value><value>99999</value></GuidelineDashPattern>');
    bbm = bbm.replace(/(<MeasureFont>[\s\S]*?<Size>)[^<]*(<\/Size>)/, '$1100000$2');
    const { doc, snapshot } = await create(bbm);
    const first = (sheet(doc, 'ruler').get('rulerItems') as Y.Array<unknown>).get(0);
    const read = (f: string) => (first instanceof Y.Map ? first.get(f) : (first as Record<string, unknown>)[f]);
    expect(read('lineThickness')).toBe(100);
    expect(read('unit')).toBe(0);
    expect(read('guidelineDashPattern')).toEqual([]);
    expect((read('measureFont') as { size: number }).size).toBe(500);
    expect([...drawingProblems(doc)]).toEqual([]);
    expect(checkGridSizes(null, snapshot)).toBeNull();
  });

  it('is made as the file has it when everything is in range', async () => {
    const { doc } = await create(fordyce);
    expect(sheet(doc, 'grid').get('subDivisionNumber')).toBe(3);
    expect([...drawingProblems(doc)]).toEqual([]);
  });
});

describe('the ranges a .bbm is put back in', () => {
  it('are inside what the live route takes, at both ends and for the default', () => {
    const L = DRAWN_LIMITS;
    const pairs: [{ min: number; max: number; fallback: number }, (v: number) => boolean][] = [
      [L.transparency, (v) => SHEET_RULES.transparency!(v)],
      [L.hullThickness, (v) => SHEET_RULES.hullProperties!({ hullThickness: v })],
      [L.subDivisionNumber, (v) => SHEET_RULES.subDivisionNumber!(v)],
      [L.gridThickness, (v) => SHEET_RULES.gridThickness!(v)],
      [L.subGridThickness, (v) => SHEET_RULES.subGridThickness!(v)],
      [L.cellIndexCorner, (v) => SHEET_RULES.cellIndexCorner!({ x: v, y: v })],
      [L.areaCellSize, (v) => SHEET_RULES.areaCellSize!(v)],
      [L.fontSize, (v) => SHEET_RULES.cellIndexFont!({ size: v }) && RULER_RULES.measureFont!({ size: v })],
      [L.lineThickness, (v) => RULER_RULES.lineThickness!(v)],
      [L.guidelineThickness, (v) => RULER_RULES.guidelineThickness!(v)],
      [L.rulerUnit, (v) => RULER_RULES.unit!(v)],
      [L.rulerCoordinate, (v) => RULER_RULES.point1!({ x: v, y: v }) && RULER_RULES.offsetDistance!(v)],
      [L.rulerRadius, (v) => RULER_RULES.radius!(v)],
    ];
    for (const [r, takes] of pairs) for (const v of [r.min, r.max, r.fallback]) expect(takes(v), `${JSON.stringify(r)} at ${v}`).toBe(true);
  });
});
