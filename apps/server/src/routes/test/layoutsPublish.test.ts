// Desktop "Publish to Server" (sync P1b): a layouts:create token creates
// layouts, personal or in an org the user may create in; other scopes
// can't.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueToken, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(deviceRoutes);
  await app.register(orgRoutes);
  await app.register(layoutRoutes);
  return app;
}

describe('publishing layouts with an API token', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  const publish = (token: string, data: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/layouts', headers: { authorization: `Bearer ${token}` }, payload: data });

  it('layouts:create publishes a personal layout and one in an org the user belongs to', async () => {
    const user = await loginAs(app, 'desk@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: user.cookie }, payload: { name: 'Club', slug: 'club' } });
    const token = await issueToken(app, user.cookie, 'layouts:create');

    const mine = await publish(token, { title: 'From desktop' });
    expect(mine.statusCode).toBe(201);
    const org = await publish(token, { title: 'Club show', orgSlug: 'club' });
    expect(org.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url: '/api/layouts', headers: { cookie: user.cookie } });
    const layouts = (list.json() as { layouts: { title: string; ownerOrgId: string | null }[] }).layouts;
    expect(layouts.map((l) => [l.title, l.ownerOrgId !== null]).sort()).toEqual([['Club show', true], ['From desktop', false]]);
  });

  it('refuses other scopes, and orgs the user is not in', async () => {
    const owner = await loginAs(app, 'owner@example.com');
    await app.inject({ method: 'POST', url: '/api/orgs', headers: { cookie: owner.cookie }, payload: { name: 'Other', slug: 'other' } });
    const user = await loginAs(app, 'desk@example.com');

    const editor = await issueToken(app, user.cookie, 'layouts:read layouts:write parts:write');
    const refused = await publish(editor, { title: 'Nope' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('insufficient_scope');

    const creator = await issueToken(app, user.cookie, 'layouts:create');
    expect((await publish(creator, { title: 'Not mine', orgSlug: 'other' })).statusCode).toBeGreaterThanOrEqual(400);
  });
});
