// A set may hold custom sets, and each one's version follows those inside
// it (utils/setVersion.ts). A set that names the same inner set many
// times, nested a few deep, must not cost the catalog more than the sets
// themselves: the catalog answers quickly whatever a person uploads.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, resetDb, schema, testVerificationToken } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { customPartRoutes } from '../customParts.js';
import { partsRoutes, invalidatePartsCache } from '../parts.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const setXml = (name: string, inner: string, times: number) =>
  `<group><Description><en>${name}</en></Description><SubPartList>${Array.from(
    { length: times },
    (_, i) => `<SubPart id="${inner}"><position><x>${i}</x><y>0</y></position><angle>0</angle></SubPart>`,
  ).join('')}</SubPartList></group>`;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(customPartRoutes);
  await app.register(partsRoutes);
  return app;
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  await app.inject({ method: 'POST', url: '/api/auth/password/register', payload: { email, password: 'correct horse battery', displayName: email } });
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const v = await db.select().from(schema.emailVerifications).where(eq(schema.emailVerifications.userId, user!.id)).get();
  const res = await app.inject({ method: 'POST', url: `/api/auth/password/verify-email/${await testVerificationToken(v!)}` });
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

describe('sets inside sets', () => {
  let app: FastifyInstance;
  let cookieHeader: string;
  beforeEach(async () => {
    resetDb();
    invalidatePartsCache();
    app = await buildApp();
    cookieHeader = await login(app, 'nest@example.com');
  });
  afterEach(async () => {
    await app.close();
  });

  const uploadSet = (partNumber: string, xml: string) =>
    app.inject({ method: 'POST', url: '/api/custom-parts', headers: { cookie: cookieHeader }, payload: { partNumber, displayName: partNumber, xmlBase64: b64(xml) } });
  const timedCatalog = async () => {
    const started = performance.now();
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog', headers: { cookie: cookieHeader } });
    return { res, took: performance.now() - started };
  };

  it('cost the catalog little, however many times a set names the one inside it', async () => {
    // n0 names n1 ten times, n1 names n2 ten times, ... : 10^7 inner sets if each is worked out every time.
    const depth = 8;
    for (let i = 0; i < depth; i++) {
      const xml = i === depth - 1 ? setXml(`n${i}`, 'nothing.here', 1) : setXml(`n${i}`, `n${i + 1}`, 10);
      expect((await uploadSet(`n${i}`, xml)).statusCode).toBe(201);
    }
    const { res, took } = await timedCatalog();
    expect(res.statusCode).toBe(200);
    expect(took).toBeLessThan(1500);
    // The outer set still follows the ones inside it.
    const parts = (res.json() as { parts: { partNumber: string; setVersion?: string }[] }).parts;
    expect(parts.find((p) => p.partNumber === 'n0')?.setVersion).toMatch(/^[0-9a-f]{16}$/);
  }, 120_000);

  it('cost the catalog little when every set names every other one', async () => {
    // 16 sets each naming the other 15: 15! chains if each is worked out every time.
    const n = 16;
    for (let i = 0; i < n; i++) {
      const subs = Array.from({ length: n }, (_, j) => j)
        .filter((j) => j !== i)
        .map((j) => `<SubPart id="m${j}"><position><x>${j}</x><y>0</y></position><angle>0</angle></SubPart>`)
        .join('');
      expect((await uploadSet(`m${i}`, `<group><Description><en>m${i}</en></Description><SubPartList>${subs}</SubPartList></group>`)).statusCode).toBe(201);
    }
    const { res, took } = await timedCatalog();
    expect(res.statusCode).toBe(200);
    expect(took).toBeLessThan(1500);
  }, 120_000);
});
