// A club where only admins add things ("membersCanCreate" off): plain
// members can't add layouts, venues or modules there and only view its
// modules, but they stay editors of its layouts. Aaron chose this on
// 2026-10-20; per-club roles will later replace the toggle.

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachUser } from '../../auth/cookie.js';
import { registerApiRoutes } from '../all.js';
import { closeAll } from '../../events/hub.js';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';

let app: FastifyInstance;
let admin: { cookie: string; id: string };
let member: { cookie: string; id: string };
let layoutId: string;
let moduleId: string;

const call = (who: { cookie: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: { cookie: who.cookie }, ...(payload ? { payload } : {}) });

beforeAll(async () => {
  resetDb();
  app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await registerApiRoutes(app);
  await app.ready();
  admin = await loginAs(app, 'locked-admin@example.com');
  member = await loginAs(app, 'locked-member@example.com');
  const now = new Date();
  const orgId = randomUUID();
  await db.insert(schema.orgs).values({ id: orgId, name: 'Locked', slug: 'locked', createdAt: now, createdBy: admin.id, membersCanCreate: false });
  await db.insert(schema.orgMembers).values([
    { orgId, userId: admin.id, role: 'admin', joinedAt: now },
    { orgId, userId: member.id, role: 'member', joinedAt: now },
  ]);
  layoutId = (await call(admin, 'POST', '/api/layouts', { title: 'Club layout', orgSlug: 'locked' })).json().id as string;
  moduleId = (await call(admin, 'POST', '/api/modules', { title: 'Club module', orgSlug: 'locked' })).json().id as string;
});
afterAll(async () => {
  closeAll();
  await app.close();
});

describe('a club where only admins add things', () => {
  it('refuses a plain member adding a layout, and makes them a viewer of its modules', async () => {
    expect((await call(member, 'POST', '/api/layouts', { title: 'x', orgSlug: 'locked' })).statusCode).toBe(403);
    expect((await call(member, 'PATCH', `/api/modules/${moduleId}`, { title: 'renamed' })).statusCode).toBe(403);
  });

  it('keeps a plain member an editor of its layouts (decided 2026-10-20)', async () => {
    expect((await call(member, 'GET', `/api/layouts/${layoutId}`)).json()).toMatchObject({ role: 'editor' });
    expect((await call(member, 'PATCH', `/api/layouts/${layoutId}`, { title: 'renamed' })).statusCode).toBe(200);
  });
});
