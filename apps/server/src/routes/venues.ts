// Venue library routes — CRUD for saved Venue JSON blobs.
// Personal venues: owned by the requesting user.
// Org venues: owned by an org; caller must be an org member.

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { checkGrowth } from '../limits/limits.js';
import { requireUser } from '../auth/cookie.js';
import { destinationOrg, matchesOwner, ownerLookup, resolveOwnerFilter } from './owners.js';

// The desktop app reaches these with an API token too: venues:read to list
// and download, venues:write to save, rename and delete.
const TOKEN_READ = { apiToken: 'venues:read' } as const;
const TOKEN_WRITE = { apiToken: 'venues:write' } as const;

export async function venueRoutes(app: FastifyInstance): Promise<void> {
  // ---- list venues visible to the user -----------------------------------
  app.get<{ Querystring: { owner?: string } }>('/api/venues', { config: TOKEN_READ }, async (req, reply) => {
    const user = requireUser(req);
    // ?owner=all|me|<club slug>: a club the caller isn't in is not found.
    const filter = await resolveOwnerFilter(user.id, req.query?.owner);
    if (!filter) return reply.code(404).send({ error: 'org_not_found' });

    const cols = {
      id: schema.venueLibrary.id,
      name: schema.venueLibrary.name,
      ownerUserId: schema.venueLibrary.ownerUserId,
      ownerOrgId: schema.venueLibrary.ownerOrgId,
    };
    const personal = await db.select(cols).from(schema.venueLibrary).where(eq(schema.venueLibrary.ownerUserId, user.id));
    const orgOwned = await db
      .select({ venue: cols, memberRole: schema.orgMembers.role })
      .from(schema.orgMembers)
      .innerJoin(schema.venueLibrary, eq(schema.venueLibrary.ownerOrgId, schema.orgMembers.orgId))
      .where(eq(schema.orgMembers.userId, user.id));

    const seen = new Set<string>();
    const all: { id: string; name: string; ownerUserId: string | null; ownerOrgId: string | null; canManage: boolean }[] = [];
    for (const v of personal) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      all.push({ ...v, canManage: true });
    }
    for (const { venue, memberRole } of orgOwned) {
      if (seen.has(venue.id)) continue;
      seen.add(venue.id);
      // Same rights as PATCH / DELETE: a club's rooms are its admins' to change.
      all.push({ ...venue, canManage: memberRole === 'admin' });
    }
    const shown = all.filter((v) => matchesOwner(v, filter, user.id));
    const ownerOf = await ownerLookup(shown);
    return {
      venues: shown.map((v) => {
        const owner = ownerOf(v);
        return {
          ...v,
          ownerOrgName: owner?.kind === 'org' ? owner.name : null,
          ownerOrgSlug: owner?.kind === 'org' ? owner.slug : null,
          owner,
        };
      }),
    };
  });

  // ---- get one venue (data included) -------------------------------------
  app.get<{ Params: { id: string } }>('/api/venues/:id', { config: TOKEN_READ }, async (req, reply) => {
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
    { config: TOKEN_WRITE },
    async (req, reply) => {
      const user = requireUser(req);
      const { name, data, orgSlug } = req.body;
      if (!name || !data) return reply.code(400).send({ error: 'name and data required' });

      const dest = await destinationOrg(user.id, orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const ownerOrgId = dest.orgId;
      const refusal = await checkGrowth({
        actor: user,
        owner: ownerOrgId ? { kind: 'org', id: ownerOrgId } : { kind: 'user', id: user.id },
        add: { bytes: JSON.stringify(data).length },
      });
      if (refusal) return reply.code(refusal.status).send(refusal.body);

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

  // ---- rename / update a venue ---------------------------------------------
  // Venue Library "Rename" (desktop VenueLibraryPanel.cpp:244-255 renames
  // the file). Same rights as delete: the personal owner or an org admin.
  app.patch<{ Params: { id: string }; Body: { name?: string; data?: unknown } }>(
    '/api/venues/:id',
    { config: TOKEN_WRITE },
    async (req, reply) => {
      const user = requireUser(req);
      const row = await db
        .select()
        .from(schema.venueLibrary)
        .where(eq(schema.venueLibrary.id, req.params.id))
        .get();
      if (!row) return reply.code(404).send({ error: 'Not found' });
      if (!(await canManage(row, user.id))) return reply.code(403).send({ error: 'Forbidden' });

      const { name, data } = req.body ?? {};
      const updates: { name?: string; data?: string } = {};
      if (name !== undefined) {
        const t = typeof name === 'string' ? name.trim() : '';
        if (!t) return reply.code(400).send({ error: 'invalid name' });
        // Desktop refuses a rename onto an existing venue's file name
        // (VenueLibraryPanel.cpp:249-252); here, another venue of the same
        // owner with that name, ignoring case.
        const siblings = await db
          .select({ id: schema.venueLibrary.id, name: schema.venueLibrary.name })
          .from(schema.venueLibrary)
          .where(
            row.ownerOrgId
              ? eq(schema.venueLibrary.ownerOrgId, row.ownerOrgId)
              : and(eq(schema.venueLibrary.ownerUserId, row.ownerUserId ?? ''), isNull(schema.venueLibrary.ownerOrgId)),
          );
        if (siblings.some((v) => v.id !== row.id && v.name.toLowerCase() === t.toLowerCase())) {
          return reply.code(409).send({ error: 'name_taken' });
        }
        updates.name = t;
      }
      if (data !== undefined) {
        if (!data || typeof data !== 'object') return reply.code(400).send({ error: 'invalid data' });
        updates.data = JSON.stringify(data);
      }
      if (Object.keys(updates).length === 0) return reply.code(400).send({ error: 'no updates' });

      await db.update(schema.venueLibrary).set(updates).where(eq(schema.venueLibrary.id, row.id));
      return { ok: true, id: row.id, name: updates.name ?? row.name };
    },
  );

  // ---- delete a venue -----------------------------------------------------
  app.delete<{ Params: { id: string } }>('/api/venues/:id', { config: TOKEN_WRITE }, async (req, reply) => {
    const user = requireUser(req);
    const row = await db
      .select()
      .from(schema.venueLibrary)
      .where(eq(schema.venueLibrary.id, req.params.id))
      .get();
    if (!row) return reply.code(404).send({ error: 'Not found' });
    if (!(await canManage(row, user.id))) return reply.code(403).send({ error: 'Forbidden' });

    await db.delete(schema.venueLibrary).where(eq(schema.venueLibrary.id, req.params.id));
    return { ok: true };
  });
  // ---- copy a room to yourself or a club ----------------------------------
  // Anyone who can open the room can copy it, into their own rooms or a
  // club they're in. The copy is the new owner's to change.
  app.post<{ Params: { id: string }; Body: { orgSlug?: string } }>(
    '/api/venues/:id/copy',
    { config: TOKEN_WRITE },
    async (req, reply) => {
      const user = requireUser(req);
      const row = await db.select().from(schema.venueLibrary).where(eq(schema.venueLibrary.id, req.params.id)).get();
      if (!row || !(await canRead(row, user.id))) return reply.code(404).send({ error: 'not_found' });
      const dest = await destinationOrg(user.id, req.body?.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      const ownerUserId = dest.orgId ? null : user.id;
      const refusal = await checkGrowth({
        actor: user,
        owner: dest.orgId ? { kind: 'org', id: dest.orgId } : { kind: 'user', id: user.id },
        add: { bytes: row.data.length },
      });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
      const name = await freeName(row.name, ownerUserId, dest.orgId);
      const id = randomUUID();
      await db.insert(schema.venueLibrary).values({
        id,
        ownerUserId,
        ownerOrgId: dest.orgId,
        name,
        data: row.data,
        createdAt: new Date(),
      });
      return reply.code(201).send({ id, name });
    },
  );

  // ---- move a room to a club ------------------------------------------------
  // Like a layout's transfer to a club: whoever may change the room (its
  // owner, or an admin of the club holding it) can hand it to a club they're
  // in. A club's room never moves back out to one person; copy it instead.
  app.post<{ Params: { id: string }; Body: { orgSlug?: string } }>(
    '/api/venues/:id/move',
    { config: TOKEN_WRITE },
    async (req, reply) => {
      const user = requireUser(req);
      const row = await db.select().from(schema.venueLibrary).where(eq(schema.venueLibrary.id, req.params.id)).get();
      if (!row || !(await canRead(row, user.id))) return reply.code(404).send({ error: 'not_found' });
      if (!(await canManage(row, user.id))) return reply.code(403).send({ error: 'forbidden' });
      if (!req.body?.orgSlug) return reply.code(400).send({ error: 'org_owned_rooms_can_only_move_to_orgs' });
      const dest = await destinationOrg(user.id, req.body.orgSlug);
      if (!dest.ok) return reply.code(dest.code).send({ error: dest.error });
      if (dest.orgId === row.ownerOrgId) return { ok: true, id: row.id, name: row.name };
      const taken = await db
        .select({ id: schema.venueLibrary.id, name: schema.venueLibrary.name })
        .from(schema.venueLibrary)
        .where(eq(schema.venueLibrary.ownerOrgId, dest.orgId!));
      if (taken.some((v) => v.name.toLowerCase() === row.name.toLowerCase())) {
        return reply.code(409).send({ error: 'name_taken' });
      }
      const refusal = await checkGrowth({ actor: user, owner: { kind: 'org', id: dest.orgId! }, add: { bytes: row.data.length } });
      if (refusal) return reply.code(refusal.status).send(refusal.body);
      await db
        .update(schema.venueLibrary)
        .set({ ownerUserId: null, ownerOrgId: dest.orgId })
        .where(eq(schema.venueLibrary.id, row.id));
      return { ok: true, id: row.id, name: row.name };
    },
  );
}

/** The personal owner, or any member of the club that owns it. */
async function canRead(row: { ownerUserId: string | null; ownerOrgId: string | null }, userId: string): Promise<boolean> {
  if (row.ownerUserId === userId) return true;
  if (!row.ownerOrgId) return false;
  const mem = await db
    .select()
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, row.ownerOrgId), eq(schema.orgMembers.userId, userId)))
    .get();
  return mem != null;
}

/** `name`, or "name (copy)", "name (copy 2)"… when the new owner already has that name. */
async function freeName(name: string, ownerUserId: string | null, ownerOrgId: string | null): Promise<string> {
  const siblings = await db
    .select({ name: schema.venueLibrary.name })
    .from(schema.venueLibrary)
    .where(
      ownerOrgId
        ? eq(schema.venueLibrary.ownerOrgId, ownerOrgId)
        : and(eq(schema.venueLibrary.ownerUserId, ownerUserId ?? ''), isNull(schema.venueLibrary.ownerOrgId)),
    );
  const taken = new Set(siblings.map((v) => v.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (copy)` : `${name} (copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Only the owner (personal venue) or an org admin (org venue) may change or delete it. */
async function canManage(
  row: { ownerUserId: string | null; ownerOrgId: string | null },
  userId: string,
): Promise<boolean> {
  if (row.ownerUserId && row.ownerUserId !== userId) return false;
  if (row.ownerOrgId) {
    const mem = await db
      .select()
      .from(schema.orgMembers)
      .where(
        and(eq(schema.orgMembers.orgId, row.ownerOrgId), eq(schema.orgMembers.userId, userId)),
      )
      .get();
    if (!mem || mem.role !== 'admin') return false;
  }
  return true;
}
