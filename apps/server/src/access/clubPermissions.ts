// Club roles and permissions (0033). Every check on what a club member may
// do goes through here: `clubAccess` answers who you are in a club (your
// roles and the union of their permissions), `can` asks one permission,
// and `clubThingAccess` turns that into your role on one of the club's
// layouts, modules or parts (resolveResourceRole adds per-item shares on
// top, so a share can only add).
//
// A club starts with Admin, Manager, Member and Viewer. Their starting
// permissions give exactly what the old fixed admin / manager / member
// roles gave, so nothing changed for anyone on the day roles came in
// (clubPermissions.test.ts pins that). The Admin role always has every
// permission and can't be edited; a club always keeps one Admin.
//
// A member with no member_roles rows (someone added before the roles were
// set up, or by code that only writes org_members) gets the built-in role
// that org_members.role names.

import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { ClubRole } from './clubRoles.js';

export const CLUB_PERMISSIONS = [
  'view_items',
  'edit_layouts',
  'start_layouts',
  'edit_modules',
  'add_parts',
  'manage_venues',
  'send_catalog',
  'invite',
  'manage_members',
  'export_data',
  'delete_items',
] as const;
export type ClubPermission = (typeof CLUB_PERMISSIONS)[number];

export function isClubPermission(v: unknown): v is ClubPermission {
  return typeof v === 'string' && (CLUB_PERMISSIONS as readonly string[]).includes(v);
}

export type BuiltinRoleKey = 'admin' | 'manager' | 'member' | 'viewer';
export const BUILTIN_ROLES: readonly BuiltinRoleKey[] = ['admin', 'manager', 'member', 'viewer'];
const BUILTIN_NAMES: Record<BuiltinRoleKey, string> = { admin: 'Admin', manager: 'Manager', member: 'Member', viewer: 'Viewer' };

const MEMBER_ADDS: ClubPermission[] = ['start_layouts', 'edit_modules'];

/** A built-in role's starting permissions. Member follows "members can add things". */
export function defaultPermissions(key: BuiltinRoleKey, membersCanCreate = true): ClubPermission[] {
  switch (key) {
    case 'admin':
      return [...CLUB_PERMISSIONS];
    case 'manager':
      return CLUB_PERMISSIONS.filter((p) => p !== 'manage_members' && p !== 'export_data');
    case 'member':
      return ['view_items', 'edit_layouts', ...(membersCanCreate ? MEMBER_ADDS : []), 'add_parts'];
    case 'viewer':
      return ['view_items'];
  }
}

/** Permissions in the order they're listed, deduplicated, with view_items always in. */
export function normalizePermissions(perms: Iterable<string>): ClubPermission[] {
  const set = new Set<string>(perms);
  set.add('view_items');
  return CLUB_PERMISSIONS.filter((p) => set.has(p));
}

function parsePermissions(json: string): ClubPermission[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? normalizePermissions(v.filter(isClubPermission)) : ['view_items'];
  } catch {
    return ['view_items'];
  }
}

export interface ClubRoleRow {
  id: string;
  key: BuiltinRoleKey | null;
  name: string;
  permissions: ClubPermission[];
  position: number;
}

/** The club's roles, in order; makes the four built-in ones the first time. */
export async function clubRoleList(orgId: string): Promise<ClubRoleRow[]> {
  let rows = await db.select().from(schema.clubRoles).where(eq(schema.clubRoles.orgId, orgId)).orderBy(schema.clubRoles.position);
  if (!rows.some((r) => r.key === 'admin')) {
    await ensureClubRoles(orgId);
    rows = await db.select().from(schema.clubRoles).where(eq(schema.clubRoles.orgId, orgId)).orderBy(schema.clubRoles.position);
  }
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    // The Admin role always has everything, whatever is stored.
    permissions: r.key === 'admin' ? [...CLUB_PERMISSIONS] : parsePermissions(r.permissions),
    position: r.position,
  }));
}

/**
 * Makes the club's four built-in roles if it has none yet, and gives each
 * member without a role the one org_members.role names. Safe to call again.
 */
export async function ensureClubRoles(orgId: string): Promise<void> {
  const org = await db.select({ membersCanCreate: schema.orgs.membersCanCreate }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).get();
  if (!org) return;
  const now = new Date();
  BUILTIN_ROLES.forEach((key, i) => {
    db.insert(schema.clubRoles)
      .values({
        id: `${orgId}:${key}`,
        orgId,
        key,
        name: BUILTIN_NAMES[key],
        permissions: JSON.stringify(defaultPermissions(key, org.membersCanCreate)),
        position: i,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
  });
  const members = await db.select({ userId: schema.orgMembers.userId, role: schema.orgMembers.role }).from(schema.orgMembers).where(eq(schema.orgMembers.orgId, orgId));
  const held = new Set(
    (await db.select({ userId: schema.memberRoles.userId }).from(schema.memberRoles).where(eq(schema.memberRoles.orgId, orgId))).map((r) => r.userId),
  );
  for (const m of members) {
    if (held.has(m.userId)) continue;
    db.insert(schema.memberRoles).values({ orgId, userId: m.userId, roleId: `${orgId}:${m.role}` }).onConflictDoNothing().run();
  }
}

export interface ClubAccess {
  orgId: string;
  /** The strongest built-in role held ('member' when only custom roles), as org_members.role. */
  role: ClubRole;
  /** Holds the Admin role: everything, including the admin-only things. */
  isAdmin: boolean;
  permissions: ReadonlySet<ClubPermission>;
  roleIds: string[];
}

interface RoleDef {
  id: string;
  orgId: string;
  key: BuiltinRoleKey | null;
  permissions: string;
}

function accessFrom(orgId: string, legacy: ClubRole, held: RoleDef[], membersCanCreate: boolean): ClubAccess {
  if (held.length === 0) {
    // No role rows: the built-in role org_members.role names, as it starts.
    return { orgId, role: legacy, isAdmin: legacy === 'admin', permissions: new Set(defaultPermissions(legacy, membersCanCreate)), roleIds: [] };
  }
  const perms = new Set<ClubPermission>();
  let isAdmin = false;
  for (const r of held) {
    if (r.key === 'admin') isAdmin = true;
    for (const p of r.key === 'admin' ? CLUB_PERMISSIONS : parsePermissions(r.permissions)) perms.add(p);
  }
  return { orgId, role: headlineRole(held.map((r) => r.key)), isAdmin, permissions: perms, roleIds: held.map((r) => r.id) };
}

/** A member holding only the built-in role `key`, as it starts (tests, and the old fixed rules). */
export function builtinAccess(key: BuiltinRoleKey, membersCanCreate = true, orgId = ''): ClubAccess {
  return {
    orgId,
    role: key === 'viewer' ? 'member' : key,
    isAdmin: key === 'admin',
    permissions: new Set(defaultPermissions(key, membersCanCreate)),
    roleIds: [`${orgId}:${key}`],
  };
}

/** org_members.role for a set of held roles: the strongest built-in one. */
export function headlineRole(keys: (BuiltinRoleKey | null)[]): ClubRole {
  if (keys.includes('admin')) return 'admin';
  if (keys.includes('manager')) return 'manager';
  return 'member';
}

/** Who `userId` is in each of `orgIds` (all their clubs when omitted). Non-members are absent. */
export async function clubAccessMap(userId: string, orgIds?: string[]): Promise<Map<string, ClubAccess>> {
  const out = new Map<string, ClubAccess>();
  if (orgIds && orgIds.length === 0) return out;
  const memberships = await db
    .select({ orgId: schema.orgMembers.orgId, role: schema.orgMembers.role, membersCanCreate: schema.orgs.membersCanCreate })
    .from(schema.orgMembers)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
    .where(orgIds ? and(eq(schema.orgMembers.userId, userId), inArray(schema.orgMembers.orgId, orgIds)) : eq(schema.orgMembers.userId, userId));
  if (memberships.length === 0) return out;
  const held = await db
    .select({ id: schema.clubRoles.id, orgId: schema.clubRoles.orgId, key: schema.clubRoles.key, permissions: schema.clubRoles.permissions })
    .from(schema.memberRoles)
    .innerJoin(schema.clubRoles, eq(schema.clubRoles.id, schema.memberRoles.roleId))
    .where(
      and(
        eq(schema.memberRoles.userId, userId),
        inArray(
          schema.memberRoles.orgId,
          memberships.map((m) => m.orgId),
        ),
      ),
    );
  const byOrg = new Map<string, RoleDef[]>();
  for (const h of held) byOrg.set(h.orgId, [...(byOrg.get(h.orgId) ?? []), h]);
  // No role rows yet: the stored built-in role named by org_members.role,
  // when the club has edited it, else its starting permissions.
  const bare = memberships.filter((m) => !byOrg.has(m.orgId));
  if (bare.length) {
    const builtins = await db
      .select({ id: schema.clubRoles.id, orgId: schema.clubRoles.orgId, key: schema.clubRoles.key, permissions: schema.clubRoles.permissions })
      .from(schema.clubRoles)
      .where(inArray(schema.clubRoles.orgId, bare.map((m) => m.orgId)));
    for (const m of bare) {
      const b = builtins.find((r) => r.orgId === m.orgId && r.key === m.role);
      if (b) byOrg.set(m.orgId, [b]);
    }
  }
  for (const m of memberships) out.set(m.orgId, accessFrom(m.orgId, m.role, byOrg.get(m.orgId) ?? [], m.membersCanCreate));
  return out;
}

/**
 * Who each member of the club is (their roles and permissions), keyed by
 * user id: the same rows and fallbacks as clubAccessMap, for the whole
 * club at once (who hears about what: access/clubNotices.ts).
 */
export async function clubMembersAccess(orgId: string): Promise<Map<string, ClubAccess>> {
  const out = new Map<string, ClubAccess>();
  const org = await db.select({ membersCanCreate: schema.orgs.membersCanCreate }).from(schema.orgs).where(eq(schema.orgs.id, orgId)).get();
  if (!org) return out;
  const members = await db.select({ userId: schema.orgMembers.userId, role: schema.orgMembers.role }).from(schema.orgMembers).where(eq(schema.orgMembers.orgId, orgId));
  if (members.length === 0) return out;
  const roles = await db
    .select({ id: schema.clubRoles.id, orgId: schema.clubRoles.orgId, key: schema.clubRoles.key, permissions: schema.clubRoles.permissions })
    .from(schema.clubRoles)
    .where(eq(schema.clubRoles.orgId, orgId));
  const byId = new Map(roles.map((r) => [r.id, r]));
  const held = new Map<string, RoleDef[]>();
  for (const h of await db.select({ userId: schema.memberRoles.userId, roleId: schema.memberRoles.roleId }).from(schema.memberRoles).where(eq(schema.memberRoles.orgId, orgId))) {
    const def = byId.get(h.roleId);
    if (def) held.set(h.userId, [...(held.get(h.userId) ?? []), def]);
  }
  for (const m of members) {
    // No role rows yet: the stored built-in role org_members.role names, as clubAccessMap does.
    const defs = held.get(m.userId) ?? roles.filter((r) => r.key === m.role);
    out.set(m.userId, accessFrom(orgId, m.role, defs, org.membersCanCreate));
  }
  return out;
}

/** Who `userId` is in the club, or null when they aren't in it. */
export async function clubAccess(userId: string, orgId: string): Promise<ClubAccess | null> {
  return (await clubAccessMap(userId, [orgId])).get(orgId) ?? null;
}

/**
 * The one permission check: may `userId` do `perm` in the club? False
 * for non-members. Routes and the live-sync handler all ask this (or
 * clubAccess / clubThingAccess, which read the same rows).
 */
export async function can(userId: string, orgId: string, perm: ClubPermission): Promise<boolean> {
  return !!(await clubAccess(userId, orgId))?.permissions.has(perm);
}

export function has(access: ClubAccess | null | undefined, perm: ClubPermission): boolean {
  return !!access?.permissions.has(perm);
}

export type ThingKind = 'layout' | 'module' | 'custom_part';
const EDIT_PERM: Record<ThingKind, ClubPermission> = { layout: 'edit_layouts', module: 'edit_modules', custom_part: 'add_parts' };

/**
 * A member's role on one of the club's things, from their permissions:
 * owner (rename, share, hand over, delete) with "delete club items",
 * editor with that kind's edit permission, otherwise viewer.
 */
export function clubThingAccess(access: ClubAccess, kind: ThingKind): 'owner' | 'editor' | 'viewer' {
  if (access.permissions.has('delete_items')) return 'owner';
  if (access.permissions.has(EDIT_PERM[kind])) return 'editor';
  return 'viewer';
}

/** The permission that adds a new thing of this kind to a club. */
export function addPermission(kind: 'layout' | 'module' | 'venue' | 'custom_part' | 'collection'): ClubPermission[] {
  switch (kind) {
    case 'layout':
    case 'collection':
      return ['start_layouts'];
    case 'venue':
      // Adding a venue came with "members can add things"; managing one is its own permission.
      return ['start_layouts', 'manage_venues'];
    case 'module':
      return ['edit_modules'];
    case 'custom_part':
      return ['add_parts'];
  }
}

/**
 * Whether someone with only "invite people" (not "manage members and
 * roles") may act on `target` (invite to it, remove or warn a person
 * holding it): the target gives nothing the actor lacks, and can't itself
 * invite or manage members. So a Manager acts on Members and Viewers, as
 * before, but not on other Managers or Admins.
 */
export function lesserRole(target: ReadonlySet<ClubPermission>, actor: ReadonlySet<ClubPermission>): boolean {
  if (target.has('invite') || target.has('manage_members')) return false;
  for (const p of target) if (!actor.has(p)) return false;
  return true;
}

/** Sets which roles a member holds (role ids of this club), and keeps org_members.role in step. */
export async function setMemberRoles(orgId: string, userId: string, roleIds: string[]): Promise<void> {
  const roles = await clubRoleList(orgId);
  const keep = roles.filter((r) => roleIds.includes(r.id));
  db.transaction((tx) => {
    tx.delete(schema.memberRoles).where(and(eq(schema.memberRoles.orgId, orgId), eq(schema.memberRoles.userId, userId))).run();
    for (const r of keep) tx.insert(schema.memberRoles).values({ orgId, userId, roleId: r.id }).run();
    tx.update(schema.orgMembers)
      .set({ role: headlineRole(keep.map((r) => r.key)) })
      .where(and(eq(schema.orgMembers.orgId, orgId), eq(schema.orgMembers.userId, userId)))
      .run();
  });
}

/** Gives a new member the built-in role `role` (org_members must already have them). */
export async function giveBuiltinRole(orgId: string, userId: string, role: BuiltinRoleKey, roleId?: string | null): Promise<void> {
  const roles = await clubRoleList(orgId);
  const chosen = (roleId && roles.find((r) => r.id === roleId)) || roles.find((r) => r.key === role);
  if (chosen) await setMemberRoles(orgId, userId, [chosen.id]);
}

/** Adds one of the club's built-in roles to what a member holds (keeping the rest). */
export async function addBuiltinRole(orgId: string, userId: string, key: BuiltinRoleKey): Promise<void> {
  const now = await clubAccess(userId, orgId);
  if (!now) return;
  const held = now.roleIds.length ? now.roleIds : [`${orgId}:${now.role}`];
  await setMemberRoles(orgId, userId, [...new Set([...held, `${orgId}:${key}`])]);
}

/** How many members hold the Admin role. */
export async function adminCount(orgId: string): Promise<number> {
  await ensureClubRoles(orgId);
  const rows = await db
    .select({ userId: schema.memberRoles.userId })
    .from(schema.memberRoles)
    .where(and(eq(schema.memberRoles.orgId, orgId), eq(schema.memberRoles.roleId, `${orgId}:admin`)));
  return rows.length;
}

export function newRoleId(): string {
  return randomUUID();
}
