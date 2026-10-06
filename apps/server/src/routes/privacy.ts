// Privacy: a person's own data.
//
//   GET  /api/me/privacy/exports                 my data downloads, and when I may ask again
//   POST /api/me/privacy/exports                 build a new one (one per Privacy setting's hours)
//   GET  /api/privacy/exports/:id/download       the zip (binary): only whoever asked for it
//   GET  /api/me/deletion                        what deleting my account would do, and what to do first
//   POST /api/me/deletion                        delete my account (typed email or name); it waits first
//
// Downloads are built in the background (privacy/exports.ts); the person
// gets a notice and an email when theirs is ready.

import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { describeExport, exportPath, listExports, nextExportAllowedAt, startExport } from '../privacy/exports.js';
import { privacySettings } from '../privacy/settings.js';
import { clearSessionCookie, requireUser } from '../auth/cookie.js';
import { confirmMatches, deletionSummary, requestDeletion } from '../privacy/accountDeletion.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me/privacy/exports', async (req) => {
    const user = requireUser(req);
    const subject = { kind: 'user' as const, id: user.id };
    const s = await privacySettings();
    return {
      exports: await listExports(user.id, subject),
      nextAllowedAt: await nextExportAllowedAt(user.id, subject),
      everyHours: s.exportEveryHours,
      keepDays: s.exportKeepDays,
      maxMb: s.exportMaxMb,
    };
  });

  app.post('/api/me/privacy/exports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account', message: 'The demo account has no data of its own to download.' });
    const subject = { kind: 'user' as const, id: user.id };
    const next = await nextExportAllowedAt(user.id, subject);
    if (next !== null) {
      reply.header('retry-after', String(Math.max(1, Math.ceil((next - Date.now()) / 1000))));
      return reply.code(429).send({
        error: 'export_too_soon',
        nextAllowedAt: next,
        message: `You can ask for another download after ${new Date(next).toUTCString()}.`,
      });
    }
    const row = await startExport({ subject, requestedBy: user.id, reason: 'self' });
    await writeAuditEvent({ resourceKind: 'user', resourceId: user.id, userId: user.id, eventType: 'data_export', payload: { exportId: row.id, reason: 'self' } });
    return reply.code(202).send({ export: describeExport(row) });
  });

  // ---- Delete my account ----------------------------------------------------
  app.get('/api/me/deletion', async (req) => {
    const user = requireUser(req);
    return deletionSummary(user);
  });

  app.post<{ Body: { confirm?: unknown } }>('/api/me/deletion', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account', message: 'The demo account belongs to everyone, so it can’t be deleted.' });
    if (!confirmMatches(user, req.body?.confirm)) {
      return reply.code(400).send({ error: 'confirm_mismatch', message: 'Type your email address (or your name) exactly to confirm.' });
    }
    const summary = await deletionSummary(user);
    if (summary.blockers.length) {
      return reply.code(409).send({ error: 'deletion_blocked', message: summary.blockers.map((b) => b.text).join(' '), blockers: summary.blockers });
    }
    if (summary.pending) return { ok: true, dueAt: summary.pending.dueAt };
    const { dueAt } = await requestDeletion(user);
    clearSessionCookie(reply);
    return reply.code(202).send({ ok: true, dueAt: dueAt.getTime() });
  });

  app.get<{ Params: { id: string } }>(
    '/api/privacy/exports/:id/download',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'not_found' });
      const row = await db.select().from(schema.dataExports).where(eq(schema.dataExports.id, req.params.id)).get();
      // Someone else's download is "not found", not "forbidden": it doesn't exist for them.
      if (!row || row.requestedBy !== user.id) return reply.code(404).send({ error: 'not_found' });
      const out = describeExport(row);
      const path = exportPath(row.id);
      if (!out.downloadUrl || !existsSync(path)) return reply.code(410).send({ error: 'export_gone', message: 'This download has expired. Ask for a new one.' });
      await db.update(schema.dataExports).set({ downloadedAt: new Date() }).where(eq(schema.dataExports.id, row.id));
      await writeAuditEvent({
        resourceKind: row.subjectKind === 'user' ? 'user' : 'org',
        resourceId: row.subjectId,
        userId: user.id,
        eventType: 'data_export_download',
        payload: { exportId: row.id },
      });
      const day = row.createdAt.toISOString().slice(0, 10);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="brick-layout-data-${day}.zip"`);
      reply.header('Cache-Control', 'private, no-store');
      return reply.send(createReadStream(path));
    },
  );
}
