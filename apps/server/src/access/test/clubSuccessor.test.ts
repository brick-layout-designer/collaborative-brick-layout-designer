// Who a club turns to when someone leaves for good (clubSuccessor): chosen
// by what their roles may do, not by the old fixed role names. An admin
// first, then whoever may manage members and roles, then whoever may
// invite, then anyone; the longest-serving member within each.

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../../test/helpers.js';
import { clubSuccessor, ensureClubRoles, setMemberRoles, type ClubPermission } from '../clubPermissions.js';

const ORG = 'club-1';
let day = 0;

async function person(name: string, role: 'admin' | 'manager' | 'member' = 'member'): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({ id, email: `${name}@x.com`, displayName: name, createdAt: new Date() });
  // Each one joins a day after the last: the earlier, the longer-serving.
  await db.insert(schema.orgMembers).values({ orgId: ORG, userId: id, role, joinedAt: new Date(Date.UTC(2026, 0, 1 + day++)) });
  return id;
}

async function customRole(name: string, perms: ClubPermission[]): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.clubRoles).values({ id, orgId: ORG, key: null, name, permissions: JSON.stringify(perms), position: 9, createdAt: new Date() });
  return id;
}

describe('clubSuccessor', () => {
  beforeEach(async () => {
    resetDb();
    day = 0;
    await db.insert(schema.orgs).values({ id: ORG, name: 'Rail Club', slug: 'rail', createdAt: new Date() });
  });

  it('prefers a custom role that may manage members and roles over a longer-serving Manager or Member', async () => {
    const leaving = await person('ann', 'admin');
    await person('bob');
    await person('cat', 'manager');
    const crew = await person('dee');
    await ensureClubRoles(ORG);
    await setMemberRoles(ORG, crew, [await customRole('People crew', ['view_items', 'manage_members'])]);
    expect(await clubSuccessor(ORG, leaving)).toBe(crew);
  });

  it('then someone who may invite (a Manager as it starts), before a plain Member', async () => {
    const leaving = await person('ann', 'admin');
    await person('bob');
    const manager = await person('cat', 'manager');
    await ensureClubRoles(ORG);
    expect(await clubSuccessor(ORG, leaving)).toBe(manager);
  });

  it('goes by permission, not the role’s name: a Manager role without invite ranks as anyone', async () => {
    const leaving = await person('ann', 'admin');
    const oldMember = await person('bob');
    await person('cat', 'manager');
    await ensureClubRoles(ORG);
    await db
      .update(schema.clubRoles)
      .set({ permissions: JSON.stringify(['view_items', 'edit_layouts']) })
      .where(eq(schema.clubRoles.id, `${ORG}:manager`));
    expect(await clubSuccessor(ORG, leaving)).toBe(oldMember);
  });

  it('an admin comes first; within a rank the longest-serving member', async () => {
    const leaving = await person('ann');
    const firstAdmin = await person('bob', 'admin');
    await person('cat', 'admin');
    await ensureClubRoles(ORG);
    const viewer = await person('dee');
    await setMemberRoles(ORG, viewer, [`${ORG}:viewer`]);
    expect(await clubSuccessor(ORG, leaving)).toBe(firstAdmin);
  });

  it('nobody qualifies: the longest-serving member, as before; nobody else: null', async () => {
    const leaving = await person('ann', 'admin');
    const first = await person('bob');
    const second = await person('cat');
    await ensureClubRoles(ORG);
    await setMemberRoles(ORG, second, [await customRole('Track crew', ['view_items', 'edit_layouts'])]);
    expect(await clubSuccessor(ORG, leaving)).toBe(first);
    await db.delete(schema.orgMembers);
    expect(await clubSuccessor(ORG, leaving)).toBeNull();
  });

  it('members without role rows yet go by the built-in role org_members names', async () => {
    const leaving = await person('ann', 'admin');
    await person('bob');
    const manager = await person('cat', 'manager');
    // No ensureClubRoles: no club_roles or member_roles rows at all.
    expect(await clubSuccessor(ORG, leaving)).toBe(manager);
  });
});
