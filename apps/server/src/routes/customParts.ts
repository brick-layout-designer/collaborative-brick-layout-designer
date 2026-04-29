// Custom parts (Phase 6.5).
//
// User- or org-uploaded brick definitions. The wire shape mirrors the
// catalog endpoint where possible: `partNumber`, `displayName`, sprite
// URL. The XML and sprite blobs are stored in SQLite — for v1 the parts
// catalog stays single-user / single-org scoped; a follow-up pass can
// fold custom parts into the global `/api/parts/catalog` response so
// the editor parts panel surfaces them inline.
//
// Sharing tiers mirror layouts: owner / editor / viewer; org ownership
// available; explicit collaborators via `custom_part_collaborators`.

import { randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type Role } from '../access/resolveResourceRole.js';
import { sendInviteEmail } from '../email/sendInvite.js';
import { env } from '../env.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';

interface CreatePartBody {
  partNumber: string;
  displayName: string;
  /** Base64-encoded XML payload. Bodies stay in JSON for simplicity. */
  xmlBase64: string;
  /** Base64-encoded sprite (gif or png). */
  spriteBase64: string;
  spriteMime: 'image/gif' | 'image/png';
  /** When set, the part is org-owned. Caller must be a member of the org. */
  orgSlug?: string;
}

interface InviteBody {
  email: string;
  role: 'viewer' | 'editor';
}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// 4MB cap on a sprite + XML (combined) — generous for legitimate parts,
// still bounded so a malicious user can't bloat the database.
const MAX_PART_BLOB_BYTES = 4 * 1024 * 1024;

export async function customPartRoutes(app: FastifyInstance): Promise<void> {
  // ---- list parts the user can see ---------------------------------------
  app.get('/api/custom-parts', async (req) => {
    const user = requireUser(req);
    const personal = await db
      .select()
      .from(schema.customParts)
      .where(eq(schema.customParts.ownerUserId, user.id));
    const orgOwned = await db
      .select({ part: schema.customParts })
      .from(schema.orgMembers)
      .innerJoin(
        schema.customParts,
        eq(schema.customParts.ownerOrgId, schema.orgMembers.orgId),
      )
      .where(eq(schema.orgMembers.userId, user.id));
    const shared = await db
      .select({ part: schema.customParts })
      .from(schema.customPartCollaborators)
      .innerJoin(
        schema.customParts,
        eq(schema.customParts.id, schema.customPartCollaborators.customPartId),
      )
      .where(eq(schema.customPartCollaborators.userId, user.id));

    const seen = new Set<string>();
    const all: ReturnType<typeof toListItem>[] = [];
    for (const p of personal) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      all.push(toListItem(p));
    }
    for (const { part } of orgOwned) {
      if (seen.has(part.id)) continue;
      seen.add(part.id);
      all.push(toListItem(part));
    }
    for (const { part } of shared) {
      if (seen.has(part.id)) continue;
      seen.add(part.id);
      all.push(toListItem(part));
    }
    return { parts: all };
  });

  // ---- get one part (metadata + role; sprite via separate URL) -----------
  app.get<{ Params: { id: string } }>('/api/custom-parts/:id', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    const part = await db
      .select()
      .from(schema.customParts)
      .where(eq(schema.customParts.id, req.params.id))
      .get();
    if (!part) return reply.code(404).send({ error: 'not_found' });
    return { part: toListItem(part), role };
  });

  // ---- get sprite (raw bytes) --------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/custom-parts/:id/sprite',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const part = await db
        .select({
          spriteBlob: schema.customParts.spriteBlob,
          spriteMime: schema.customParts.spriteMime,
        })
        .from(schema.customParts)
        .where(eq(schema.customParts.id, req.params.id))
        .get();
      if (!part) return reply.code(404).send({ error: 'not_found' });
      reply.header('Content-Type', part.spriteMime);
      reply.header('Cache-Control', 'private, max-age=300');
      return reply.send(Buffer.from(part.spriteBlob as Uint8Array));
    },
  );

  // ---- get XML (text) ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/custom-parts/:id/xml',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const part = await db
        .select({ xmlBlob: schema.customParts.xmlBlob })
        .from(schema.customParts)
        .where(eq(schema.customParts.id, req.params.id))
        .get();
      if (!part) return reply.code(404).send({ error: 'not_found' });
      reply.header('Content-Type', 'application/xml; charset=utf-8');
      return reply.send(Buffer.from(part.xmlBlob as Uint8Array).toString('utf8'));
    },
  );

  // ---- create -------------------------------------------------------------
  app.post<{ Body: CreatePartBody }>('/api/custom-parts', async (req, reply) => {
    const user = requireUser(req);
    const body = req.body ?? ({} as CreatePartBody);

    const partNumber = body.partNumber?.trim();
    const displayName = body.displayName?.trim();
    if (!partNumber || !displayName) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    if (body.spriteMime !== 'image/gif' && body.spriteMime !== 'image/png') {
      return reply.code(400).send({ error: 'invalid_sprite_mime' });
    }

    let xmlBlob: Buffer;
    let spriteBlob: Buffer;
    try {
      xmlBlob = Buffer.from(body.xmlBase64, 'base64');
      spriteBlob = Buffer.from(body.spriteBase64, 'base64');
    } catch {
      return reply.code(400).send({ error: 'invalid_base64' });
    }
    if (xmlBlob.length === 0 || spriteBlob.length === 0) {
      return reply.code(400).send({ error: 'empty_payload' });
    }
    if (xmlBlob.length + spriteBlob.length > MAX_PART_BLOB_BYTES) {
      return reply.code(413).send({ error: 'payload_too_large' });
    }

    let ownerUserId: string | null = user.id;
    let ownerOrgId: string | null = null;
    if (body.orgSlug) {
      const org = await db
        .select({ id: schema.orgs.id })
        .from(schema.orgs)
        .where(eq(schema.orgs.slug, body.orgSlug.toLowerCase()))
        .get();
      if (!org) return reply.code(404).send({ error: 'org_not_found' });
      const membership = await db
        .select()
        .from(schema.orgMembers)
        .where(
          and(
            eq(schema.orgMembers.orgId, org.id),
            eq(schema.orgMembers.userId, user.id),
          ),
        )
        .get();
      if (!membership) return reply.code(403).send({ error: 'not_an_org_member' });
      ownerUserId = null;
      ownerOrgId = org.id;
    }

    // Reject duplicate `partNumber` for the same owner. (No DB unique
    // constraint because owner is split across two columns; we check
    // explicitly here.)
    const dupQuery = ownerOrgId
      ? db
          .select()
          .from(schema.customParts)
          .where(
            and(
              eq(schema.customParts.ownerOrgId, ownerOrgId),
              eq(schema.customParts.partNumber, partNumber),
            ),
          )
      : db
          .select()
          .from(schema.customParts)
          .where(
            and(
              eq(schema.customParts.ownerUserId, user.id),
              eq(schema.customParts.partNumber, partNumber),
            ),
          );
    const dup = await dupQuery.get();
    if (dup) return reply.code(409).send({ error: 'part_number_taken' });

    const id = randomUUID();
    const now = new Date();
    await db.insert(schema.customParts).values({
      id,
      partNumber,
      displayName,
      ownerUserId,
      ownerOrgId,
      createdBy: user.id,
      xmlBlob,
      spriteBlob,
      spriteMime: body.spriteMime,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent({
      resourceKind: 'custom_part',
      resourceId: id,
      userId: user.id,
      eventType: 'create',
      payload: { partNumber, displayName, owner: ownerOrgId ? { kind: 'org', id: ownerOrgId } : { kind: 'user', id: user.id } },
    });
    return reply.code(201).send({ id, partNumber, displayName });
  });

  // ---- delete -------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/api/custom-parts/:id',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await db.delete(schema.customParts).where(eq(schema.customParts.id, req.params.id));
      await writeAuditEvent({
        resourceKind: 'custom_part',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'delete',
        payload: {},
      });
      return { ok: true };
    },
  );

  // ---- collaborators (mirror /api/layouts/.../collaborators shape) -------
  app.get<{ Params: { id: string } }>(
    '/api/custom-parts/:id/collaborators',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });

      const collaborators = await db
        .select({
          userId: schema.customPartCollaborators.userId,
          role: schema.customPartCollaborators.role,
          addedAt: schema.customPartCollaborators.addedAt,
          email: schema.users.email,
          displayName: schema.users.displayName,
          avatarUrl: schema.users.avatarUrl,
        })
        .from(schema.customPartCollaborators)
        .innerJoin(schema.users, eq(schema.users.id, schema.customPartCollaborators.userId))
        .where(eq(schema.customPartCollaborators.customPartId, req.params.id));
      return {
        collaborators: collaborators.map((c) => ({
          userId: c.userId,
          role: c.role,
          addedAt: c.addedAt.getTime(),
          email: c.email,
          displayName: c.displayName,
          avatarUrl: c.avatarUrl,
        })),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: InviteBody }>(
    '/api/custom-parts/:id/invites',
    async (req, reply) => {
      const user = requireUser(req);
      if (user.isDemoAccount) {
        return reply.code(403).send({ error: 'demo_account_cannot_invite' });
      }
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      if (!hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const { email, role: inviteRole } = req.body;
      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'invalid_email' });
      }
      if (inviteRole !== 'viewer' && inviteRole !== 'editor') {
        return reply.code(400).send({ error: 'invalid_role' });
      }

      // For now custom-part invites are immediate add (recipient must
      // already have an account). A token-based flow can land later if
      // we want feature parity with layout invites; the MVP for v1 is
      // "share with someone you know".
      const recipient = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (!recipient) {
        // Persist the invite as a pending row; once the recipient
        // registers + hits POST /api/custom-part-invites/:token they
        // get added to custom_part_collaborators.
        const token = randomBytes(24).toString('hex');
        const inviteId = randomUUID();
        const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
        await db.insert(schema.customPartInvites).values({
          id: inviteId,
          customPartId: req.params.id,
          invitedEmail: email,
          role: inviteRole,
          token,
          expiresAt,
          acceptedAt: null,
        });
        const inviteUrl = `${env.publicUrl}/custom-part-invite/${token}`;
        let emailDelivered = false;
        try {
          emailDelivered = await sendInviteEmail({
            to: email,
            inviteUrl,
            inviterName: user.displayName,
          });
        } catch {
          /* ignored — caller can hand-deliver the URL */
        }
        await writeAuditEvent({
          resourceKind: 'custom_part',
          resourceId: req.params.id,
          userId: user.id,
          eventType: 'share',
          payload: { invitedEmail: email, role: inviteRole, inviteId, pending: true },
        });
        return reply.code(202).send({
          pending: true,
          inviteUrl,
          emailDelivered,
          expiresAt: expiresAt.getTime(),
        });
      }

      await db
        .insert(schema.customPartCollaborators)
        .values({
          customPartId: req.params.id,
          userId: recipient.id,
          role: inviteRole,
          addedAt: new Date(),
        })
        .onConflictDoNothing();
      await writeAuditEvent({
        resourceKind: 'custom_part',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'share',
        payload: { targetUserId: recipient.id, role: inviteRole },
      });
      return { added: true };
    },
  );

  app.patch<{
    Params: { id: string; userId: string };
    Body: { role: 'viewer' | 'editor' };
  }>('/api/custom-parts/:id/collaborators/:userId', async (req, reply) => {
    const user = requireUser(req);
    const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'owner')) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const newRole = req.body.role;
    if (newRole !== 'viewer' && newRole !== 'editor') {
      return reply.code(400).send({ error: 'invalid_role' });
    }
    await db
      .update(schema.customPartCollaborators)
      .set({ role: newRole })
      .where(
        and(
          eq(schema.customPartCollaborators.customPartId, req.params.id),
          eq(schema.customPartCollaborators.userId, req.params.userId),
        ),
      );
    await writeAuditEvent({
      resourceKind: 'custom_part',
      resourceId: req.params.id,
      userId: user.id,
      eventType: 'role_change',
      payload: { targetUserId: req.params.userId, toRole: newRole },
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/custom-parts/:id/collaborators/:userId',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'custom_part', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });
      const isSelf = req.params.userId === user.id;
      if (!isSelf && !hasAtLeast(role, 'owner')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      await db
        .delete(schema.customPartCollaborators)
        .where(
          and(
            eq(schema.customPartCollaborators.customPartId, req.params.id),
            eq(schema.customPartCollaborators.userId, req.params.userId),
          ),
        );
      await writeAuditEvent({
        resourceKind: 'custom_part',
        resourceId: req.params.id,
        userId: user.id,
        eventType: 'unshare',
        payload: { targetUserId: req.params.userId, selfRemoved: isSelf },
      });
      return { ok: true };
    },
  );
}

function toListItem(p: typeof schema.customParts.$inferSelect) {
  return {
    id: p.id,
    partNumber: p.partNumber,
    displayName: p.displayName,
    ownerUserId: p.ownerUserId,
    ownerOrgId: p.ownerOrgId,
    spriteMime: p.spriteMime,
    createdAt: p.createdAt.getTime(),
    updatedAt: p.updatedAt.getTime(),
  };
}
