// Regression tests for email identity:
//   - addresses are normalised (trim + lower-case) on register/login and
//     matched case-insensitively against legacy mixed-case rows
//   - invite / transfer acceptance requires a verified email
//   - Google sign-in refuses addresses Google hasn't verified

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { createSession } from '../../auth/session.js';
import { passwordRoutes } from '../auth/password.js';
import { fetchGoogleProfile, UnverifiedEmailError } from '../auth/oauth.js';
import { layoutRoutes } from '../layouts.js';
import { collaboratorRoutes } from '../collaborators.js';
import { inviteRoutes } from '../invites.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  await app.register(collaboratorRoutes);
  await app.register(inviteRoutes);
  return app;
}

const PASSWORD = 'correct horse battery';

describe('email normalisation', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('stores registered emails lower-cased and trimmed, and blocks case-variant duplicates', async () => {
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: '  Bob@Example.COM ', password: PASSWORD },
    });
    expect(r1.statusCode).toBe(200);
    const row = await db.select().from(schema.users).where(eq(schema.users.email, 'bob@example.com')).get();
    expect(row).toBeDefined();

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'bob@example.com', password: PASSWORD },
    });
    expect(r2.statusCode).toBe(409);
  });

  it('treats a legacy mixed-case row as taken and lets its owner log in with any casing', async () => {
    await db.insert(schema.users).values({
      id: randomUUID(),
      email: 'Carol@Example.com',
      displayName: 'Carol',
      passwordHash: null,
      createdAt: new Date(),
    });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/password/register',
      payload: { email: 'carol@example.com', password: PASSWORD },
    });
    expect(dup.statusCode).toBe(409);

    const u = await loginAs(app, 'dave@example.com');
    expect(u.cookie).toContain('cld_session');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/password/login',
      payload: { email: ' DAVE@example.com', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });
});

describe('invite acceptance requires a verified email', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    resetDb();
    app = await buildApp();
  });
  afterEach(async () => {
    await app.close();
  });

  async function unverifiedSession(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.users).values({
      id,
      email,
      displayName: email,
      passwordHash: null,
      emailVerified: false,
      createdAt: new Date(),
    });
    const { token } = await createSession(id);
    return `cld_session=${token}`;
  }

  it('rejects an unverified account even when the email matches', async () => {
    const owner = await loginAs(app, 'owner@x.com');
    const layoutId = (
      await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: owner.cookie }, payload: {} })
    ).json().id as string;
    const invite = await app.inject({
      method: 'POST',
      url: `/api/layouts/${layoutId}/invites`,
      headers: { cookie: owner.cookie },
      payload: { email: 'Victim@X.com', role: 'editor' },
    });
    expect(invite.statusCode).toBe(200);
    const stored = await db.select().from(schema.layoutInvites).get();
    expect(stored!.invitedEmail).toBe('victim@x.com');

    const squatter = await unverifiedSession('victim@x.com');
    const res = await app.inject({
      method: 'POST',
      url: `/api/invites/${invite.json().token}`,
      headers: { cookie: squatter },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('email_not_verified');
    expect(await db.select().from(schema.layoutCollaborators).all()).toHaveLength(0);
  });
});

describe('Google sign-in', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubUserinfo(body: object): void {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  }

  it('refuses an email Google has not verified', async () => {
    stubUserinfo({ sub: '1', email: 'someone@corp.example', email_verified: false });
    await expect(fetchGoogleProfile('tok')).rejects.toBeInstanceOf(UnverifiedEmailError);
    stubUserinfo({ sub: '1', email: 'someone@corp.example' });
    await expect(fetchGoogleProfile('tok')).rejects.toBeInstanceOf(UnverifiedEmailError);
  });

  it('accepts a verified email', async () => {
    stubUserinfo({ sub: '1', email: 'someone@gmail.com', email_verified: true, name: 'S' });
    const profile = await fetchGoogleProfile('tok');
    expect(profile.email).toBe('someone@gmail.com');
  });
});
