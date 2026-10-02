// Admin › Settings: the background jobs and the demo layout lifetime are
// switches there (an env var, when set, forces one and the page names it),
// and the server's env-only settings are listed read-only, never showing a
// secret's value.
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, loginAs, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { adminRoutes } from '../admin.js';
import { backgroundJobs, demoExpiry } from '../../workers/jobs.js';
import { env } from '../../env.js';

let app: FastifyInstance;
let admin: { cookie: string; id: string };
const saved = { backups: env.backupsEnabledForced, days: env.demoLayoutTtlDaysForced, google: env.google };

beforeEach(async () => {
  resetDb();
  app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  for (const r of [passwordRoutes, sessionRoutes, adminRoutes]) await app.register(r);
  admin = await loginAs(app, 'jobs-admin@example.com');
  db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id)).run();
  env.backupsEnabledForced = null;
  env.demoLayoutTtlDaysForced = null;
});
afterEach(async () => {
  env.backupsEnabledForced = saved.backups;
  env.demoLayoutTtlDaysForced = saved.days;
  env.google = saved.google;
  await app.close();
});

const patch = (payload: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: { cookie: admin.cookie }, payload });
const page = async () =>
  (await app.inject({ url: '/api/admin/settings', headers: { cookie: admin.cookie } })).json() as {
    jobs: Awaited<ReturnType<typeof backgroundJobs>>;
    serverSetup: { name: string; value: string; env: string; why: string }[];
  };

describe('background jobs in Admin › Settings', () => {
  it('are on by default, switch off at once, and the demo lifetime is used for new demo layouts', async () => {
    expect((await page()).jobs.backups).toEqual({ value: true, setting: true, forcedBy: null });
    expect((await patch({ backupsEnabled: false, demoLayoutTtlDays: 7 })).statusCode).toBe(200);
    expect((await backgroundJobs()).backups.value).toBe(false);
    const now = new Date('2026-10-01T00:00:00Z');
    expect((await demoExpiry(now)).toISOString()).toBe('2026-10-08T00:00:00.000Z');
    const audit = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'admin_settings_patch')).all();
    expect(audit.some((e) => JSON.stringify(e.payload).includes('demoLayoutTtlDays'))).toBe(true);
  });

  it('a set env var wins, and the page says which one', async () => {
    await patch({ backupsEnabled: false });
    env.backupsEnabledForced = true;
    env.demoLayoutTtlDaysForced = 3;
    const { jobs } = await page();
    expect(jobs.backups).toEqual({ value: true, setting: false, forcedBy: 'BACKUPS_ENABLED' });
    expect(jobs.demoLayoutTtlDays).toMatchObject({ value: 3, forcedBy: 'DEMO_LAYOUT_TTL_DAYS' });
  });

  it('refuses a demo lifetime that is not a whole number of days', async () => {
    for (const bad of [0, -1, 1.5, 'ten', 99999]) expect((await patch({ demoLayoutTtlDays: bad })).statusCode).toBe(400);
  });
});

describe('the server setup list', () => {
  it('names each env-only setting and why, and never shows a secret', async () => {
    env.google = { clientId: 'id-123', clientSecret: 'very-secret-value' };
    const res = await app.inject({ url: '/api/admin/settings', headers: { cookie: admin.cookie } });
    expect(res.body).not.toContain('very-secret-value');
    const rows = (res.json() as Awaited<ReturnType<typeof page>>).serverSetup;
    expect(rows.find((r) => r.name === 'Google sign-in')).toMatchObject({ value: 'Set up', why: 'secret' });
    expect(rows.find((r) => r.env === 'PARTS_DIR')?.why).toBe('deploy');
    expect(rows.find((r) => r.env.startsWith('BOOTSTRAP_ADMIN'))?.why).toBe('bootstrap');
  });

  it('is for site admins only', async () => {
    const someone = await loginAs(app, 'someone@example.com');
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: someone.cookie } })).statusCode).toBe(403);
  });
});
