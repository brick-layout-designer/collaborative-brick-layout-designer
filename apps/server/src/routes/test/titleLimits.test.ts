// Titles and names have one limit everywhere (200 characters, as renames
// already had), and someone else's venue is "not found".

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { clampTitle, MAX_TITLE, titleTooLong } from '../../utils/validate.js';

let app: FastifyInstance;
let a: string;
let b: string;
const LONG = 'x'.repeat(MAX_TITLE + 1);
const EMOJI_OK = '🚂'.repeat(MAX_TITLE); // 200 characters, 400 UTF-16 units

const post = (url: string, cookieStr: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie: cookieStr }, payload });
const patch = (url: string, cookieStr: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url, headers: { cookie: cookieStr }, payload });

beforeAll(async () => {
  resetDb();
  app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await registerApiRoutes(app);
  await app.ready();
  a = (await loginAs(app, 'titles-a@example.com')).cookie;
  b = (await loginAs(app, 'titles-b@example.com')).cookie;
});
afterAll(async () => {
  closeAll();
  await app.close();
});

describe('title helpers', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(titleTooLong(EMOJI_OK)).toBe(false);
    expect(titleTooLong(EMOJI_OK + '🚂')).toBe(true);
    expect(titleTooLong(undefined)).toBe(false);
    expect([...clampTitle(`${EMOJI_OK} (copy)`)].length).toBe(MAX_TITLE);
  });
});

describe('layouts', () => {
  it('refuse a title over the limit on create and copy, and accept one at it', async () => {
    expect((await post('/api/layouts', a, { title: LONG })).statusCode).toBe(400);
    const ok = await post('/api/layouts', a, { title: EMOJI_OK });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id as string;
    expect((await post(`/api/layouts/${id}/copy`, a, { title: LONG })).statusCode).toBe(400);
    // A made-up copy title is cut to fit.
    const copy = await post(`/api/layouts/${id}/copy`, a, {});
    expect(copy.statusCode).toBe(201);
    const row = await db.select().from(schema.layouts).where(eq(schema.layouts.id, copy.json().id as string)).get();
    expect([...row!.title].length).toBe(MAX_TITLE);
  });
});

describe('modules', () => {
  it('refuse a title over the limit on create, rename and copy', async () => {
    expect((await post('/api/modules', a, { title: LONG })).statusCode).toBe(400);
    const ok = await post('/api/modules', a, { title: 'Yard' });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id as string;
    expect((await patch(`/api/modules/${id}`, a, { title: LONG })).statusCode).toBe(400);
    expect((await post(`/api/modules/${id}/copy`, a, { title: LONG })).statusCode).toBe(400);
  });
});

describe('venues', () => {
  it('refuse a name over the limit, and are not found for someone else', async () => {
    expect((await post('/api/venues', a, { name: LONG, data: { walls: [] } })).statusCode).toBe(400);
    const ok = await post('/api/venues', a, { name: 'Hall', data: { walls: [] } });
    expect(ok.statusCode).toBe(201);
    const id = ok.json().id as string;
    expect((await patch(`/api/venues/${id}`, a, { name: LONG })).statusCode).toBe(400);
    const theirs = await app.inject({ method: 'GET', url: `/api/venues/${id}`, headers: { cookie: b } });
    const missing = await app.inject({ method: 'GET', url: '/api/venues/00000000-0000-4000-8000-000000000000', headers: { cookie: b } });
    expect(theirs.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
  });
});
