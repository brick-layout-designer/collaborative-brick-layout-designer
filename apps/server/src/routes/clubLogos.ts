// Club logos (0037):
//
//   PUT    /api/orgs/:slug/logo   {mime, data}  a club admin sets it (PNG, JPEG, WebP or SVG; images/logos.ts)
//   DELETE /api/orgs/:slug/logo                 a club admin removes it
//   GET    /api/orgs/:slug/logo?v=…              the picture (WebP): members, site admins, and,
//                                               for a club listed in the directory, anyone signed in
//
// Club lists, the club page, the directory and pickers show it through
// `logoUrl` (clubLogoUrls), which changes with each new picture.

import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { isDemoUser } from '../demo/demoAccount.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import { LOGO_BODY_LIMIT, readLogoBody } from '../images/logos.js';
import { perPerson } from '../utils/rateLimits.js';
import { getMembership, loadOrgBySlug } from './orgs.js';

/** The logo's address for each club that has one (by club id), changing with each new picture. */
export async function clubLogoUrls(orgs: readonly { id: string; slug: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orgs.length === 0) return out;
  const rows = await db
    .select({ orgId: schema.clubLogos.orgId, at: schema.clubLogos.updatedAt })
    .from(schema.clubLogos)
    .where(inArray(schema.clubLogos.orgId, orgs.map((o) => o.id)));
  const slugs = new Map(orgs.map((o) => [o.id, o.slug]));
  for (const r of rows) out.set(r.orgId, `/api/orgs/${encodeURIComponent(slugs.get(r.orgId)!)}/logo?v=${r.at.getTime()}`);
  return out;
}

export async function clubLogoRoutes(app: FastifyInstance): Promise<void> {
  app.put<{ Params: { slug: string }; Body: { mime?: unknown; data?: unknown } | undefined }>(
    '/api/orgs/:slug/logo',
    { bodyLimit: LOGO_BODY_LIMIT, config: { rateLimit: perPerson(30, '1 hour') } },
    async (req, reply) => {
      const user = requireUser(req);
      if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account' });
      const org = await loadOrgBySlug(req.params.slug);
      const me = org && !org.deletionDueAt ? await getMembership(org.id, user.id) : null;
      if (!org || !me) return reply.code(404).send({ error: 'not_found' });
      if (!me.isAdmin) return reply.code(403).send({ error: 'only_club_admins', message: 'Only the club’s admins can change its logo.' });
      const read = await readLogoBody(req.body);
      if (!read.ok) return reply.code(read.code).send(read.body);
      const now = new Date();
      db.insert(schema.clubLogos)
        .values({ orgId: org.id, image: read.image, updatedBy: user.id, updatedAt: now })
        .onConflictDoUpdate({ target: schema.clubLogos.orgId, set: { image: read.image, updatedBy: user.id, updatedAt: now } })
        .run();
      await writeAuditEvent({ resourceKind: 'org', resourceId: org.id, userId: user.id, eventType: 'club_logo_set', payload: { bytes: read.image.length } });
      return { ok: true, logoUrl: (await clubLogoUrls([org])).get(org.id) ?? null };
    },
  );

  app.delete<{ Params: { slug: string } }>('/api/orgs/:slug/logo', async (req, reply) => {
    const user = requireUser(req);
    const org = await loadOrgBySlug(req.params.slug);
    const me = org && !org.deletionDueAt ? await getMembership(org.id, user.id) : null;
    if (!org || !me) return reply.code(404).send({ error: 'not_found' });
    if (!me.isAdmin) return reply.code(403).send({ error: 'only_club_admins', message: 'Only the club’s admins can change its logo.' });
    const gone = db.delete(schema.clubLogos).where(eq(schema.clubLogos.orgId, org.id)).run();
    if (gone.changes > 0) await writeAuditEvent({ resourceKind: 'org', resourceId: org.id, userId: user.id, eventType: 'club_logo_remove', payload: {} });
    return { ok: true };
  });

  app.get<{ Params: { slug: string } }>(
    '/api/orgs/:slug/logo',
    { config: { rateLimit: perPerson(600, '1 minute') } },
    async (req, reply) => {
      const user = requireUser(req);
      const org = await loadOrgBySlug(req.params.slug);
      // A listed club shows in the directory to everyone signed in; any other only to its members.
      const sees = !!org && !org.deletionDueAt && (org.listed || user.isGlobalAdmin || !!(await getMembership(org.id, user.id)));
      const row = sees ? await db.select({ image: schema.clubLogos.image }).from(schema.clubLogos).where(eq(schema.clubLogos.orgId, org!.id)).get() : undefined;
      if (!row) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', 'image/webp')
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'")
        .header('cache-control', 'private, max-age=86400')
        .send(row.image as Buffer);
    },
  );
}
