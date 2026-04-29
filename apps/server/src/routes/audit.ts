// Read-side endpoints for the audit log.
//
// Two query shapes:
//   GET /api/layouts/:id/audit          → layout-scoped (legacy; what
//                                         the layout audit panel uses)
//   GET /api/audit?kind=...&id=...      → generic; works for layouts +
//                                         custom_parts + modules + orgs
//
// Both require the caller to have at least viewer access on the
// target resource (the same access check as the resource itself, so
// there's no extra information leak vs. just opening it).

import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireUser } from '../auth/cookie.js';
import { hasAtLeast, resolveResourceRole, type ResourceKind } from '../access/resolveResourceRole.js';
import type { AuditResourceKind } from '../audit/writeAuditEvent.js';

interface AuditQuery {
  kind?: AuditResourceKind;
  id?: string;
  /** Pagination — newest first. Defaults to 100, max 500. */
  limit?: string;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // ---- layout-scoped (the editor's audit panel) -------------------------
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/layouts/:id/audit',
    async (req, reply) => {
      const user = requireUser(req);
      const { role } = await resolveResourceRole(user.id, 'layout', req.params.id);
      if (role === null) return reply.code(404).send({ error: 'not_found' });

      const limit = clampLimit(req.query.limit);
      const rows = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.layoutId, req.params.id))
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(limit);
      return {
        events: rows.map(toWire),
      };
    },
  );

  // ---- generic ----------------------------------------------------------
  app.get<{ Querystring: AuditQuery }>('/api/audit', async (req, reply) => {
    const user = requireUser(req);
    const kind = req.query.kind;
    const id = req.query.id;
    if (!kind || !id) {
      return reply.code(400).send({ error: 'kind_and_id_required' });
    }
    if (!isResolvableKind(kind)) {
      // Org-scoped audits aren't yet wired into resolveResourceRole; we
      // refuse the read until they are. Layouts / custom_parts / modules
      // all dispatch through the helper.
      return reply.code(400).send({ error: 'unsupported_kind' });
    }
    const { role } = await resolveResourceRole(user.id, kind, id);
    if (role === null) return reply.code(404).send({ error: 'not_found' });
    if (!hasAtLeast(role, 'viewer')) {
      return reply.code(404).send({ error: 'not_found' });
    }

    const limit = clampLimit(req.query.limit);
    const rows = await (kind === 'layout'
      ? db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.layoutId, id))
          .orderBy(desc(schema.auditEvents.createdAt))
          .limit(limit)
      : db
          .select()
          .from(schema.auditEvents)
          .where(
            and(
              eq(schema.auditEvents.resourceKind, kind),
              eq(schema.auditEvents.resourceId, id),
            ),
          )
          .orderBy(desc(schema.auditEvents.createdAt))
          .limit(limit));
    return { events: rows.map(toWire) };
  });
}

function isResolvableKind(kind: AuditResourceKind): kind is ResourceKind {
  return kind === 'layout' || kind === 'custom_part' || kind === 'module';
}

function clampLimit(raw: string | undefined): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function toWire(row: typeof schema.auditEvents.$inferSelect) {
  return {
    id: row.id,
    layoutId: row.layoutId,
    resourceKind: row.resourceKind,
    resourceId: row.resourceId,
    userId: row.userId,
    eventType: row.eventType,
    payload: safeParse(row.payload),
    docVersion: row.docVersion,
    createdAt: row.createdAt.getTime(),
  };
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return { _parseError: true, raw: json };
  }
}
