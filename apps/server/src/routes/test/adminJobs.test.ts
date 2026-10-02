// Admin › Settings: the background jobs are switches there (an env var, when set, forces one and the page names it),
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
import { backgroundJobs } from '../../workers/jobs.js';
import { env } from '../../env.js';

let app: FastifyInstance;
let admin: { cookie: string; id: string };
const saved = { backups: env.backupsEnabledForced, google: env.google };

beforeEach(async () => {
  resetDb();
  app = Fastify();
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  for (const r of [passwordRoutes, sessionRoutes, adminRoutes]) await app.register(r);
  admin = await loginAs(app, 'jobs-admin@example.com');
  db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.id, admin.id)).run();
  env.backupsEnabledForced = null;
});
afterEach(async () => {
  env.backupsEnabledForced = saved.backups;
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
  it('are on by default, switch off at once, and the change is audited', async () => {
    expect((await page()).jobs.backups).toEqual({ value: true, setting: true, forcedBy: null });
    expect((await patch({ backupsEnabled: false })).statusCode).toBe(200);
    expect((await backgroundJobs()).backups.value).toBe(false);
    const audit = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.eventType, 'admin_settings_patch')).all();
    expect(audit.some((e) => JSON.stringify(e.payload).includes('backupsEnabled'))).toBe(true);
  });

  it('no longer has a demo layout lifetime or expiry sweep', async () => {
    expect(Object.keys((await page()).jobs).sort()).toEqual(['backups', 'dailyCompaction']);
    expect((await patch({ demoLayoutTtlDays: 7 })).statusCode).toBe(400);
    expect((await patch({ demoTtlSweepEnabled: false })).statusCode).toBe(400);
  });

  it('a set env var wins, and the page says which one', async () => {
    await patch({ backupsEnabled: false });
    env.backupsEnabledForced = true;
    const { jobs } = await page();
    expect(jobs.backups).toEqual({ value: true, setting: false, forcedBy: 'BACKUPS_ENABLED' });
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
    // Demo mode is gone: the demo account is a switch on this page now.
    expect(rows.some((r) => r.env.startsWith('DEMO'))).toBe(false);
  });

  it('is for site admins only', async () => {
    const someone = await loginAs(app, 'someone@example.com');
    expect((await app.inject({ url: '/api/admin/settings', headers: { cookie: someone.cookie } })).statusCode).toBe(403);
  });
});
