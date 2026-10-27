// Sharing a set brings along the custom parts it's made of.
//
// A set (a `<group>` custom part) names its parts by part number. Someone a
// set is shared with also needs the sharer's own custom parts in it, or it
// places as placeholders. So accepting a set's invite also shares those
// parts, as a viewer, and custom_part_set_shares (0038) remembers which
// parts each person has only through which set. Taking the set back (or
// the person leaving it, or the set being deleted) takes those parts back,
// unless another shared set still brings them or they were shared on their
// own (a part shared on its own has no rows there).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { parsePartXml } from '@cld/parts-catalog';
import { db, schema } from '../db/index.js';
import { stripImportSource } from '../utils/partXml.js';
import { hasAtLeast, resolveResourceRole } from './resolveResourceRole.js';

export interface SetPart {
  id: string;
  partNumber: string;
  displayName: string;
}

/** The part numbers (lower-cased) a set's XML names, or none when it isn't a set. */
function subPartNumbers(xml: Uint8Array): string[] {
  try {
    const parsed = parsePartXml(stripImportSource(Buffer.from(xml)).toString('utf8'), { partNumber: 'set', colorCode: '', spritePath: '' });
    return parsed.kind === 'group' ? parsed.subparts.map((s) => s.subKey) : [];
  } catch {
    return [];
  }
}

/**
 * The custom parts that come along when `setId` is shared: the parts with
 * the set's owner (the same person or club) whose numbers the set names,
 * and the parts of any set of theirs inside it. Empty for a part that isn't
 * a set.
 */
export async function setPartsFor(setId: string): Promise<SetPart[]> {
  const set = await db
    .select({ ownerUserId: schema.customParts.ownerUserId, ownerOrgId: schema.customParts.ownerOrgId, spriteMime: schema.customParts.spriteMime })
    .from(schema.customParts)
    .where(eq(schema.customParts.id, setId))
    .get();
  if (!set || set.spriteMime !== '' || (!set.ownerUserId && !set.ownerOrgId)) return [];
  const sameOwner = set.ownerOrgId ? eq(schema.customParts.ownerOrgId, set.ownerOrgId) : eq(schema.customParts.ownerUserId, set.ownerUserId!);
  const out = new Map<string, SetPart>();
  const seenSets = new Set<string>([setId]);
  let pending = [setId];
  while (pending.length > 0) {
    const rows = await db
      .select({ xmlBlob: schema.customParts.xmlBlob })
      .from(schema.customParts)
      .where(inArray(schema.customParts.id, pending))
      .all();
    pending = [];
    const numbers = [...new Set(rows.flatMap((r) => subPartNumbers(r.xmlBlob as Uint8Array)))];
    if (numbers.length === 0) break;
    const parts = await db
      .select({
        id: schema.customParts.id,
        partNumber: schema.customParts.partNumber,
        displayName: schema.customParts.displayName,
        spriteMime: schema.customParts.spriteMime,
      })
      .from(schema.customParts)
      .where(and(sameOwner, inArray(sql`lower(${schema.customParts.partNumber})`, numbers)))
      .all();
    for (const p of parts) {
      if (p.spriteMime === '') {
        // A set inside the set: its parts come too (and the inner set itself).
        if (!seenSets.has(p.id)) {
          seenSets.add(p.id);
          pending.push(p.id);
          out.set(p.id, { id: p.id, partNumber: p.partNumber, displayName: p.displayName });
        }
        continue;
      }
      out.set(p.id, { id: p.id, partNumber: p.partNumber, displayName: p.displayName });
    }
  }
  return [...out.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber));
}

/** The parts of `setId` that `sharerId` may share (manages their sharing). */
export async function shareableSetParts(setId: string, sharerId: string | null): Promise<SetPart[]> {
  if (!sharerId) return [];
  const parts = await setPartsFor(setId);
  const out: SetPart[] = [];
  for (const p of parts) if (hasAtLeast((await resolveResourceRole(sharerId, 'custom_part', p.id)).role, 'owner')) out.push(p);
  return out;
}

/** Whether `userId` has `partId` only through shared sets. */
export async function onlyThroughSets(partId: string, userId: string): Promise<boolean> {
  const row = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.customPartSetShares)
    .where(and(eq(schema.customPartSetShares.partId, partId), eq(schema.customPartSetShares.userId, userId)))
    .get();
  return (row?.n ?? 0) > 0;
}

/**
 * `userId` just accepted `setId` from `sharerId`: they get the set's parts
 * that the sharer manages, as a viewer. A part they already have some other
 * way (their own, their club's, shared on its own) stays as it is.
 */
export async function grantSetParts(setId: string, userId: string, sharerId: string | null): Promise<SetPart[]> {
  const granted: SetPart[] = [];
  const now = new Date();
  for (const p of await shareableSetParts(setId, sharerId)) {
    const { role } = await resolveResourceRole(userId, 'custom_part', p.id);
    if (role !== null && !(await onlyThroughSets(p.id, userId))) continue;
    await db.insert(schema.customPartCollaborators).values({ customPartId: p.id, userId, role: 'viewer', addedAt: now }).onConflictDoNothing();
    await db.insert(schema.customPartSetShares).values({ setId, partId: p.id, userId, addedAt: now }).onConflictDoNothing();
    granted.push(p);
  }
  return granted;
}

/**
 * `setId` is no longer shared with `userId` (every person when null): the
 * parts it brought along go too, unless another shared set still brings
 * them. Returns the ids of the parts taken back.
 */
export async function revokeSetParts(setId: string, userId: string | null = null): Promise<string[]> {
  const where = userId
    ? and(eq(schema.customPartSetShares.setId, setId), eq(schema.customPartSetShares.userId, userId))
    : eq(schema.customPartSetShares.setId, setId);
  const rows = await db.select().from(schema.customPartSetShares).where(where).all();
  if (rows.length === 0) return [];
  await db.delete(schema.customPartSetShares).where(where);
  const taken: string[] = [];
  for (const r of rows) {
    if (await onlyThroughSets(r.partId, r.userId)) continue;
    await db
      .delete(schema.customPartCollaborators)
      .where(and(eq(schema.customPartCollaborators.customPartId, r.partId), eq(schema.customPartCollaborators.userId, r.userId)));
    taken.push(r.partId);
  }
  return taken;
}

/** `userId` now has `partId` on its own (shared directly, or taken off it): no set holds it any more. */
export async function forgetSetShares(partId: string, userId: string): Promise<void> {
  await db
    .delete(schema.customPartSetShares)
    .where(and(eq(schema.customPartSetShares.partId, partId), eq(schema.customPartSetShares.userId, userId)));
}

/** For each person who has `partId` through shared sets, those sets' names. */
export async function setsBringing(partId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ userId: schema.customPartSetShares.userId, name: schema.customParts.displayName, number: schema.customParts.partNumber })
    .from(schema.customPartSetShares)
    .innerJoin(schema.customParts, eq(schema.customParts.id, schema.customPartSetShares.setId))
    .where(eq(schema.customPartSetShares.partId, partId))
    .all();
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.name || r.number]);
  return out;
}
