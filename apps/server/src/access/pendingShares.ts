// Pending shares follow the current owner.
//
// A layout's pending transfers and invites were sent by whoever ran its
// sharing at the time. When it changes hands they're cleared, and an
// invite only holds while its sender still manages the layout's sharing.
//
// Authorship for take-back / give-back (routes/ownership.ts) ends when the
// author hands the thing to someone else by an accepted person-to-person
// transfer: it's theirs to place, not the author's to take back.

import { and, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { sameEmail } from '../utils/validate.js';
import { hasAtLeast, resolveResourceRole } from './resolveResourceRole.js';
import type { CreditKind } from '../routes/credits.js';

/**
 * Delete a layout's not-yet-accepted transfers (optionally keeping one) and
 * its pending invites. Call whenever the layout's owner changes.
 */
export async function clearPendingLayoutShares(layoutId: string, exceptTransferId?: string): Promise<void> {
  await db
    .delete(schema.layoutTransfers)
    .where(
      and(
        eq(schema.layoutTransfers.layoutId, layoutId),
        isNull(schema.layoutTransfers.acceptedAt),
        exceptTransferId ? ne(schema.layoutTransfers.id, exceptTransferId) : undefined,
      ),
    );
  await db.delete(schema.layoutInvites).where(and(eq(schema.layoutInvites.layoutId, layoutId), isNull(schema.layoutInvites.acceptedAt)));
}

/** Delete a module's not-yet-accepted transfers. Call whenever the module's owner changes. */
export async function clearPendingModuleShares(moduleId: string): Promise<void> {
  await db.delete(schema.moduleTransfers).where(and(eq(schema.moduleTransfers.moduleId, moduleId), isNull(schema.moduleTransfers.acceptedAt)));
}

/** Clear pending shares on each of a set of things that just changed hands. */
export async function clearPendingSharesFor(kind: 'layouts' | 'modules', ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    if (kind === 'layouts') await clearPendingLayoutShares(id);
    else await clearPendingModuleShares(id);
  }
}

/**
 * Who sent a layout invite: its `invitedBy`, or for invites made before that
 * column existed, the user on the audit log's `share` row that created it.
 */
async function layoutInviteSender(invite: { id: string; layoutId: string; invitedBy: string | null }): Promise<string | null> {
  if (invite.invitedBy) return invite.invitedBy;
  const row = await db
    .select({ userId: schema.auditEvents.userId })
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.layoutId, invite.layoutId),
        eq(schema.auditEvents.eventType, 'share'),
        sql`json_extract(${schema.auditEvents.payload}, '$.inviteId') = ${invite.id}`,
        sql`json_extract(${schema.auditEvents.payload}, '$.accepted') IS NULL`,
      ),
    )
    .get();
  return row?.userId ?? null;
}

/** Whether a layout invite still holds: its sender still manages the layout's sharing. */
export async function layoutInviteStillValid(invite: { id: string; layoutId: string; invitedBy: string | null }): Promise<boolean> {
  const sender = await layoutInviteSender(invite);
  if (!sender) return false;
  const { role } = await resolveResourceRole(sender, 'layout', invite.layoutId);
  return hasAtLeast(role, 'owner');
}

/**
 * Of `ids`, the ones their author handed to someone else: the newest
 * accepted person-to-person transfer went to someone other than the author.
 * `authors` maps each id to its author's id and current email.
 */
export async function handedOverIds(
  kind: CreditKind,
  authors: ReadonlyMap<string, { id: string; email: string }>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = [...authors.keys()];
  if (!ids.length || (kind !== 'layout' && kind !== 'module')) return out;
  const t = kind === 'layout' ? schema.layoutTransfers : schema.moduleTransfers;
  const thing = kind === 'layout' ? schema.layoutTransfers.layoutId : schema.moduleTransfers.moduleId;
  const rows = await db
    .select({ thingId: thing, recipientEmail: t.recipientEmail })
    .from(t)
    .where(and(inArray(thing, ids), isNotNull(t.acceptedAt)))
    .orderBy(desc(t.acceptedAt));
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.thingId)) continue;
    seen.add(r.thingId);
    const author = authors.get(r.thingId);
    if (author && !sameEmail(r.recipientEmail, author.email)) out.add(r.thingId);
  }
  return out;
}
