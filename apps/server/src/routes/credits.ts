// Author credit for layouts, modules, custom parts and venues: who made
// it ("by Sam · in ArkLUG"), what it was copied from ("based on Yard by
// Sam"), and whether the person looking may take it back from the club
// or give it back to its author (routes/ownership.ts).
//
// Names always go through publicName, so an email never shows. A deleted
// author reads "Builder #…"; an author who left the club that holds the
// item reads "a former member".

import { and, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { atLeast, type ClubRole } from '../access/clubRoles.js';
import { fallbackName, publicName } from '../utils/publicName.js';

export type CreditKind = 'layout' | 'module' | 'custom-part' | 'venue';

export interface Credit {
  /** "you", a name, "a former member" or "Builder #…"; null when nobody is recorded. */
  by: string | null;
  /** The author's public name, while their account exists (for "Give back to ‹name›"). */
  authorName: string | null;
  /** The club that holds it, or null for a person's. */
  club: string | null;
  /** What it was copied from, while that still exists. */
  basedOn: { id: string; title: string; by: string | null } | null;
  /** The person looking is its author and a member of the club holding it. */
  canTakeBack: boolean;
  /** The person looking runs the club holding it, and the author's account exists. */
  canGiveBack: boolean;
}

interface Row {
  id: string;
  title: string;
  ownerUserId: string | null;
  ownerOrgId: string | null;
  createdBy: string | null;
  deletedAuthorId: string | null;
  copiedFromId: string | null;
}

/** The table and its title column for each kind. */
function tableOf(kind: CreditKind) {
  switch (kind) {
    case 'layout':
      return { t: schema.layouts, title: schema.layouts.title, deleted: schema.layouts.deletedAuthorId };
    case 'module':
      return { t: schema.modules, title: schema.modules.title, deleted: schema.modules.deletedAuthorId };
    case 'custom-part':
      return { t: schema.customParts, title: schema.customParts.displayName, deleted: schema.customParts.deletedAuthorId };
    case 'venue':
      return { t: schema.venueLibrary, title: schema.venueLibrary.name, deleted: null };
  }
}

export async function creditRows(kind: CreditKind, ids: readonly string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const { t, title, deleted } = tableOf(kind);
  const rows = await db
    .select({
      id: t.id,
      title,
      ownerUserId: t.ownerUserId,
      ownerOrgId: t.ownerOrgId,
      createdBy: t.createdBy,
      copiedFromId: t.copiedFromId,
      ...(deleted ? { deletedAuthorId: deleted } : {}),
    })
    .from(t)
    .where(inArray(t.id, [...ids]));
  return rows.map((r) => ({ deletedAuthorId: null, ...r }) as Row);
}

/** The author's id as recorded: the deleted one wins (created_by then names someone else). */
export function authorIdOf(r: Pick<Row, 'createdBy' | 'deletedAuthorId'>): string | null {
  return r.deletedAuthorId ?? r.createdBy;
}

/**
 * A kept copy: the club's copy of something its author took back. Its
 * source is the author's own again, so taking it back twice (or giving it
 * back) would only make more copies.
 */
function isKeptCopy(r: Row, source: Row | undefined): boolean {
  const author = authorIdOf(r);
  return !!source && !!author && !source.ownerOrgId && source.ownerUserId === author;
}

/**
 * Credits for `ids` as `viewerId` sees them, in a handful of queries.
 * Returns a lookup; ids it never saw give null.
 */
export async function creditLookup(
  kind: CreditKind,
  ids: readonly string[],
  viewerId: string,
): Promise<(id: string) => Credit | null> {
  const rows = await creditRows(kind, ids);
  const sourceIds = [...new Set(rows.map((r) => r.copiedFromId).filter((x): x is string => !!x))];
  const sources = new Map((await creditRows(kind, sourceIds)).map((s) => [s.id, s]));
  const authorIds = new Set<string>();
  for (const r of [...rows, ...sources.values()]) {
    const a = authorIdOf(r);
    if (a) authorIds.add(a);
  }
  const users = authorIds.size
    ? new Map(
        (
          await db
            .select({ id: schema.users.id, name: schema.users.displayName })
            .from(schema.users)
            .where(inArray(schema.users.id, [...authorIds]))
        ).map((u) => [u.id, u.name]),
      )
    : new Map<string, string>();
  const orgIds = [...new Set(rows.map((r) => r.ownerOrgId).filter((x): x is string => !!x))];
  const orgs = orgIds.length
    ? new Map(
        (await db.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs).where(inArray(schema.orgs.id, orgIds))).map(
          (o) => [o.id, o.name],
        ),
      )
    : new Map<string, string>();
  const people = [...new Set([...authorIds, viewerId])];
  const roles = new Map<string, ClubRole>();
  if (orgIds.length) {
    const mems = await db
      .select({ o: schema.orgMembers.orgId, u: schema.orgMembers.userId, role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(and(inArray(schema.orgMembers.orgId, orgIds), inArray(schema.orgMembers.userId, people)));
    for (const m of mems) roles.set(`${m.o}:${m.u}`, m.role);
  }

  /** How a person reads in a credit line. */
  const nameOf = (r: Row, inClub: string | null): string | null => {
    if (r.deletedAuthorId) return fallbackName(r.deletedAuthorId);
    const a = r.createdBy;
    if (!a) return null;
    if (!users.has(a)) return fallbackName(a);
    if (inClub && !roles.has(`${inClub}:${a}`)) return 'a former member';
    if (a === viewerId) return 'you';
    return publicName(a, users.get(a));
  };

  const byId = new Map(rows.map((r) => [r.id, r]));
  return (id) => {
    const r = byId.get(id);
    if (!r) return null;
    const src = r.copiedFromId ? sources.get(r.copiedFromId) : undefined;
    const author = r.deletedAuthorId ? null : r.createdBy;
    const authorExists = !!author && users.has(author);
    const myRole = r.ownerOrgId ? roles.get(`${r.ownerOrgId}:${viewerId}`) : undefined;
    const kept = isKeptCopy(r, src);
    return {
      by: nameOf(r, r.ownerOrgId),
      authorName: authorExists ? publicName(author!, users.get(author!)) : null,
      club: r.ownerOrgId ? (orgs.get(r.ownerOrgId) ?? null) : null,
      basedOn: src ? { id: src.id, title: src.title, by: nameOf(src, null) } : null,
      canTakeBack: !!r.ownerOrgId && !!myRole && author === viewerId && !kept,
      canGiveBack: !!r.ownerOrgId && atLeast(myRole, 'manager') && authorExists && author !== viewerId && !kept,
    };
  };
}

/** Add `credit` to each item of a list. */
export async function withCredits<T extends { id: string }>(kind: CreditKind, items: readonly T[], viewerId: string): Promise<(T & { credit: Credit | null })[]> {
  const creditOf = await creditLookup(
    kind,
    items.map((i) => i.id),
    viewerId,
  );
  return items.map((i) => ({ ...i, credit: creditOf(i.id) }));
}

export { isKeptCopy };
