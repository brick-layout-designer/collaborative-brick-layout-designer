// Moving a set to a club brings your custom parts in it.
//
// A set (a `<group>` custom part) names its parts by part number. When it
// moves to a club, the club's members need its owner's custom parts in it
// too, or it places with missing parts for them. So the parts that come
// along with a share (setShares.setPartsFor: the owner's parts the set
// names, and the parts of a set inside it) move with it, except:
//   - a part another set of that owner still uses, outside this one: it
//     stays where it is, so that set keeps working even after its owner
//     leaves the club, and the club gets its own copy (credited to its
//     author, as a copy is);
//   - a part whose number the club already has: the set uses the club's;
//   - a part the mover may not move (a club's part they don't run).

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hasAtLeast, resolveResourceRole } from './resolveResourceRole.js';
import { setPartsFor, subPartNumbers, type SetPart } from './setShares.js';

export interface SetMovePlan {
  /** Move to the club with the set. */
  move: SetPart[];
  /** Stay where they are (another set uses them); the club gets a copy. */
  copy: SetPart[];
  /** The club already has a part with that number; the set uses that one. */
  inClub: SetPart[];
  /** Not the mover's to move; they stay where they are. */
  notYours: SetPart[];
}

export const emptyPlan = (): SetMovePlan => ({ move: [], copy: [], inClub: [], notYours: [] });

/**
 * What happens to the custom parts in set `setId` when `userId` moves it
 * to the club `destOrgId`. Empty for a part that isn't a set.
 */
export async function planSetMove(setId: string, userId: string, destOrgId: string): Promise<SetMovePlan> {
  const plan = emptyPlan();
  const set = await db
    .select({ ownerUserId: schema.customParts.ownerUserId, ownerOrgId: schema.customParts.ownerOrgId, spriteMime: schema.customParts.spriteMime })
    .from(schema.customParts)
    .where(eq(schema.customParts.id, setId))
    .get();
  if (!set || set.spriteMime !== '') return plan;
  const parts = await setPartsFor(setId);
  if (parts.length === 0) return plan;

  // The owner's other sets, outside this one (the set and the sets inside it), and the numbers they use.
  const inside = new Set([setId, ...parts.map((p) => p.id)]);
  const sameOwner = set.ownerOrgId ? eq(schema.customParts.ownerOrgId, set.ownerOrgId) : and(eq(schema.customParts.ownerUserId, set.ownerUserId ?? ''), isNull(schema.customParts.ownerOrgId));
  const otherSets = await db
    .select({ id: schema.customParts.id, xmlBlob: schema.customParts.xmlBlob })
    .from(schema.customParts)
    .where(and(sameOwner, eq(schema.customParts.spriteMime, ''), ne(schema.customParts.id, setId)))
    .all();
  const usedElsewhere = new Set(otherSets.filter((s) => !inside.has(s.id)).flatMap((s) => subPartNumbers(s.xmlBlob as Uint8Array).map((n) => n.toLowerCase())));

  // The numbers the club already has.
  const numbers = parts.map((p) => p.partNumber.toLowerCase());
  const clubHas = new Set(
    (
      await db
        .select({ n: sql<string>`lower(${schema.customParts.partNumber})` })
        .from(schema.customParts)
        .where(and(eq(schema.customParts.ownerOrgId, destOrgId), inArray(sql`lower(${schema.customParts.partNumber})`, numbers)))
        .all()
    ).map((r) => r.n),
  );

  for (const p of parts) {
    const n = p.partNumber.toLowerCase();
    if (clubHas.has(n)) {
      plan.inClub.push(p);
      continue;
    }
    // A person's part moves only by its owner; a club's by those who run it (as the move route checks).
    const mayMove = set.ownerUserId ? set.ownerUserId === userId : hasAtLeast((await resolveResourceRole(userId, 'custom_part', p.id)).role, 'owner');
    if (!mayMove) plan.notYours.push(p);
    else if (usedElsewhere.has(n)) plan.copy.push(p);
    else plan.move.push(p);
  }
  return plan;
}
