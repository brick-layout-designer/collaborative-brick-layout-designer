// Who owns a layout, room or module, for the lists that show the user's
// own things next to their clubs' things.
//
// Every list endpoint (/api/layouts, /api/modules, /api/venues) gathers
// only what the caller may already see, then:
//   - tags each item with its owner (`owner`: the user or the club, by name), and
//   - narrows to `?owner=all|me|<club slug>`.
// Asking for a club you're not in answers 404, the same as the club's own
// page, so the filter never tells a stranger what a club holds.

import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export interface OwnerInfo {
  kind: 'user' | 'org';
  id: string;
  /** The user's display name, or the club's name. */
  name: string;
  /** The club's slug; null for a person. */
  slug: string | null;
}

export type OwnerFilter = { kind: 'all' } | { kind: 'me' } | { kind: 'org'; orgId: string };

export interface Owned {
  ownerUserId: string | null;
  ownerOrgId: string | null;
}

/**
 * Read `?owner=`. Missing / empty / "all" lists everything; "me" lists the
 * caller's own; anything else is a club slug the caller must belong to.
 * Returns null when the club doesn't exist or the caller isn't in it.
 */
export async function resolveOwnerFilter(userId: string, raw: unknown): Promise<OwnerFilter | null> {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === '' || v === 'all') return { kind: 'all' };
  if (v === 'me') return { kind: 'me' };
  const row = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
    .where(and(eq(schema.orgs.slug, v), eq(schema.orgMembers.userId, userId)))
    .get();
  return row ? { kind: 'org', orgId: row.id } : null;
}

export function matchesOwner(item: Owned, filter: OwnerFilter, userId: string): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'me':
      return item.ownerUserId === userId;
    case 'org':
      return item.ownerOrgId === filter.orgId;
  }
}

/** Look up every owner of `items` in two queries; returns a lookup for one item. */
export async function ownerLookup(items: readonly Owned[]): Promise<(item: Owned) => OwnerInfo | null> {
  const orgIds = [...new Set(items.map((i) => i.ownerOrgId).filter((x): x is string => !!x))];
  const userIds = [...new Set(items.map((i) => i.ownerUserId).filter((x): x is string => !!x))];
  const orgs = orgIds.length
    ? await db
        .select({ id: schema.orgs.id, name: schema.orgs.name, slug: schema.orgs.slug })
        .from(schema.orgs)
        .where(inArray(schema.orgs.id, orgIds))
    : [];
  const users = userIds.length
    ? await db
        .select({ id: schema.users.id, name: schema.users.displayName })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : [];
  const orgById = new Map(orgs.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));
  return (item) => {
    if (item.ownerOrgId) {
      const o = orgById.get(item.ownerOrgId);
      return o ? { kind: 'org', id: o.id, name: o.name, slug: o.slug } : null;
    }
    if (item.ownerUserId) {
      const u = userById.get(item.ownerUserId);
      return u ? { kind: 'user', id: u.id, name: u.name, slug: null } : null;
    }
    return null;
  };
}

/**
 * The club a new or copied item goes to: `orgSlug` must name a club the
 * caller belongs to. Undefined / empty means the caller's own.
 */
export async function destinationOrg(
  userId: string,
  orgSlug: unknown,
): Promise<{ ok: true; orgId: string | null } | { ok: false; code: 404 | 403; error: string }> {
  if (orgSlug === undefined || orgSlug === null || orgSlug === '') return { ok: true, orgId: null };
  if (typeof orgSlug !== 'string') return { ok: false, code: 404, error: 'org_not_found' };
  const org = await db
    .select({ id: schema.orgs.id })
    .from(schema.orgs)
    .where(eq(schema.orgs.slug, orgSlug.trim().toLowerCase()))
    .get();
  if (!org) return { ok: false, code: 404, error: 'org_not_found' };
  const mem = await db
    .select({ role: schema.orgMembers.role })
    .from(schema.orgMembers)
    .where(and(eq(schema.orgMembers.orgId, org.id), eq(schema.orgMembers.userId, userId)))
    .get();
  if (!mem) return { ok: false, code: 403, error: 'not_an_org_member' };
  return { ok: true, orgId: org.id };
}
