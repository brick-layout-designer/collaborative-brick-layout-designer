// Odd layouts through the server (audit 2026-10-20, track B): created,
// exported in every format, copied, and the exported .bbm imported again,
// with nothing lost: no sheets at all, only text in unicode, only a
// ruler, only an area sheet.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBbm, writeBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { loginAs, resetDb } from '../../test/helpers.js';

const hull = { isVisible: false, hullColor: { kind: 'known' as const, name: 'Black' }, hullThickness: 1 };
const font = { family: 'Arial', size: 12, style: 'Regular' };
const UNICODE = 'Zürich 駅 🚂 «quotes» & <tags>';
const base = (): BbmMap => docToBbm(createDefaultLayoutDoc());
const layer = (l: Record<string, unknown>) => ({ visible: true, transparency: 100, hullProperties: hull, ...l }) as unknown as BbmMap['layers'][number];

const MAPS: Record<string, BbmMap> = {
  'no sheets': { ...base(), layers: [], selectedLayerIndex: -1 },
  'only text, in unicode': {
    ...base(),
    event: UNICODE,
    selectedLayerIndex: 0,
    layers: [
      layer({
        id: 't1', type: 'text', name: UNICODE, groups: [],
        textCells: [{ displayArea: { x: 1, y: 2, width: 30, height: 10 }, myGroup: '', orientation: 0, text: UNICODE, fontColor: { kind: 'known', name: 'Black' }, font, textAlignment: 'Center' }],
      }),
    ],
  },
  'only a ruler': {
    ...base(),
    selectedLayerIndex: 0,
    layers: [
      layer({
        id: 'r1', type: 'ruler', name: 'Rulers', groups: [],
        rulerItems: [{
          kind: 'linear', id: 'x', displayArea: { x: 0, y: 0, width: 10, height: 0 }, myGroup: '', color: { kind: 'known', name: 'Black' },
          lineThickness: 1, displayDistance: true, displayUnit: true, guidelineColor: { kind: 'known', name: 'Gray' }, guidelineThickness: 1,
          guidelineDashPattern: [2, 4], unit: 0, measureFont: font, measureFontColor: { kind: 'known', name: 'Black' },
          point1: { x: 0, y: 0 }, point2: { x: 10, y: 0 }, attachedBrick1Id: '', attachedBrick2Id: '', offsetDistance: 0, allowOffset: false,
        }],
      }),
    ],
  },
  'only an area sheet': {
    ...base(),
    selectedLayerIndex: 0,
    layers: [layer({ id: 'a1', type: 'area', name: 'Areas', areaCellSize: 32, areas: [{ x: 0, y: 0, color: 'FFFF0000' }, { x: -3, y: 7, color: '8000FF00' }] })],
  },
};

const shape = (m: BbmMap) => m.layers.map((l) => `${l.type}:${l.name}:${'textCells' in l ? l.textCells.map((t) => t.text).join('|') : 'areas' in l ? l.areas.length : 'rulerItems' in l ? l.rulerItems.length : ''}`);

describe('odd layouts through the server', () => {
  let app: FastifyInstance;
  let cookieHeader = '';

  beforeAll(async () => {
    resetDb();
    app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
    await app.register(cookie);
    await app.register(fastifyMultipart);
    app.addHook('preHandler', attachUser);
    await registerApiRoutes(app);
    await app.ready();
    cookieHeader = (await loginAs(app, 'edge@example.com')).cookie;
  });
  afterAll(async () => {
    closeAll();
    await app.close();
  });

  for (const [name, map] of Object.entries(MAPS)) {
    it(`${name}: imports, exports in every format, copies, and imports again unchanged`, async () => {
      const bbm = writeBbm(map);
      const made = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: cookieHeader }, payload: { title: name, bbm } });
      expect(made.statusCode, made.body).toBe(201);
      const { id } = made.json() as { id: string };
      for (const ext of ['bbm', 'bbm.bld', 'bld-layout', 'zip']) {
        const res = await app.inject({ method: 'GET', url: `/api/layouts/${id}/export.${ext}`, headers: { cookie: cookieHeader } });
        // No sidecar to export is a 404 by design.
        expect(ext === 'bbm.bld' ? [200, 404] : [200], `${ext}: ${res.body.slice(0, 120)}`).toContain(res.statusCode);
      }
      const exported = await app.inject({ method: 'GET', url: `/api/layouts/${id}/export.bbm`, headers: { cookie: cookieHeader } });
      const back = readBbm(exported.body);
      expect(back.warnings).toEqual([]);
      expect(shape(back.map)).toEqual(shape(map));
      const copy = await app.inject({ method: 'POST', url: `/api/layouts/${id}/copy`, headers: { cookie: cookieHeader }, payload: {} });
      expect(copy.statusCode, copy.body).toBe(201);
      const again = await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: cookieHeader }, payload: { bbm: exported.body } });
      expect(again.statusCode, again.body).toBe(201);
      const twice = await app.inject({ method: 'GET', url: `/api/layouts/${(again.json() as { id: string }).id}/export.bbm`, headers: { cookie: cookieHeader } });
      expect(twice.body).toBe(exported.body);
    });
  }
});
