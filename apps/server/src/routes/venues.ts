// Venue library routes — CRUD for saved Venue JSON blobs.
// Personal venues: owned by the requesting user.
// Org venues: owned by an org; caller must be an org member.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';

export async function venueRoutes(app: FastifyInstance): Promise<void> {
  // ---- list venues visible to the user -----------------------------------
  app.get('/api/venues', async (req) => {
    const user = requireUser(req);

    const personal = await db
      .select()
      .from(schema.venueLibrary)
      .where(eq(schema.venueLibrary.ownerUserId, user.id));

    const orgOwned = await db
      .select({ venue: schema.venueLibrary })
      .from(schema.orgMembers)
      .innerJoin(
        schema.venueLibrary,
        eq(schema.venueLibrary.ownerOrgId, schema.orgMembers.orgId),
      )
      .where(eq(schema.orgMembers.userId, user.id));

    const seen = new Set<string>();
    const all: { id: string; name: string; ownerOrgId: string | null }[] = [];
    for (const v of personal) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      all.push({ id: v.id, name: v.name, ownerOrgId: v.ownerOrgId });
    }
    for (const { venue } of orgOwned) {
      if (seen.has(venue.id)) continue;
      seen.add(venue.id);
      all.push({ id: venue.id, name: venue.name, ownerOrgId: venue.ownerOrgId });
    }
    return { venues: all };
  });

  // ---- get one venue (data included) -------------------------------------
  app.get<{ Params: { id: string } }>('/api/venues/:id', async (req, reply) => {
    const user = requireUser(req);
    const row = await db
      .select()
      .from(schema.venueLibrary)
      .where(eq(schema.venueLibrary.id, req.params.id))
      .get();
    if (!row) return reply.code(404).send({ error: 'Not found' });

    const canRead =
      row.ownerUserId === user.id ||
      (row.ownerOrgId != null &&
        (await db
          .select()
          .from(schema.orgMembers)
          .where(
            and(
              eq(schema.orgMembers.orgId, row.ownerOrgId),
              eq(schema.orgMembers.userId, user.id),
            ),
          )
          .get()) != null);
    if (!canRead) return reply.code(403).send({ error: 'Forbidden' });

    return { id: row.id, name: row.name, data: JSON.parse(row.data) };
  });

  // ---- save a new venue ---------------------------------------------------
  app.post<{ Body: { name: string; data: unknown; orgSlug?: string } }>(
    '/api/venues',
    async (req, reply) => {
      const user = requireUser(req);
      const { name, data, orgSlug } = req.body;
      if (!name || !data) return reply.code(400).send({ error: 'name and data required' });

      let ownerOrgId: string | null = null;
      if (orgSlug) {
        const org = await db
          .select()
          .from(schema.orgs)
          .where(eq(schema.orgs.slug, orgSlug))
          .get();
        if (!org) return reply.code(404).send({ error: 'Org not found' });
        const mem = await db
          .select()
          .from(schema.orgMembers)
          .where(
            and(eq(schema.orgMembers.orgId, org.id), eq(schema.orgMembers.userId, user.id)),
          )
          .get();
        if (!mem) return reply.code(403).send({ error: 'Not an org member' });
        ownerOrgId = org.id;
      }

      const id = randomUUID();
      await db.insert(schema.venueLibrary).values({
        id,
        ownerUserId: ownerOrgId ? null : user.id,
        ownerOrgId,
        name: name.trim(),
        data: JSON.stringify(data),
        createdAt: new Date(),
      });
      return reply.code(201).send({ id, name: name.trim() });
    },
  );

  // ---- delete a venue -----------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/venues/:id', async (req, reply) => {
    const user = requireUser(req);
    const row = await db
      .select()
      .from(schema.venueLibrary)
      .where(eq(schema.venueLibrary.id, req.params.id))
      .get();
    if (!row) return reply.code(404).send({ error: 'Not found' });

    // Only owner (personal) or org admin can delete.
    if (row.ownerUserId && row.ownerUserId !== user.id) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (row.ownerOrgId) {
      const mem = await db
        .select()
        .from(schema.orgMembers)
        .where(
          and(eq(schema.orgMembers.orgId, row.ownerOrgId), eq(schema.orgMembers.userId, user.id)),
        )
        .get();
      if (!mem || mem.role !== 'admin') return reply.code(403).send({ error: 'Forbidden' });
    }

    await db.delete(schema.venueLibrary).where(eq(schema.venueLibrary.id, req.params.id));
    return { ok: true };
  });
}
