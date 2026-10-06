// Generic access-control helper used by REST handlers AND the WS
// connection-time auth check. Mirrors the SQL function the desktop plan
// originally proposed; in SQLite it's a single TS function.
//
// A user has access to a resource iff any of:
//   1. They are the resource owner (ownerUserId match)
//   2. The resource is org-owned and they're a member of that org
//   3. They appear in the resource's collaborator table
//
// Role is the strongest of:
//   - 'owner'  — ownerUserId match, OR org-admin on the owning org
//   - 'editor' — org-member on the owning org (default), OR explicit editor
//   - 'viewer' — explicit viewer share
//
// Three resource kinds share this shape: layouts, custom_parts, modules.
// We dispatch by kind to the appropriate tables; the role-resolution
// algorithm itself is identical (per PLAN.md §3.3 / §6.5).

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { atLeast, clubThingRole, type ClubRole } from './clubRoles.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type ResourceKind = 'layout' | 'custom_part' | 'module' | 'org';

export interface RoleResolution {
  role: Role | null;
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
function strongerOf(a: Role | null, b: Role | null): Role | null {
  if (a === null) return b;
  if (b === null) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

/**
 * A club member's role on one of the club's modules. Managers and admins own
 * them; members edit them when the club lets members add things, and
 * otherwise only view them.
 */
export function clubModuleRole(role: ClubRole, membersCanCreate: boolean): Role {
  if (atLeast(role, 'manager')) return 'owner';
  return membersCanCreate ? 'editor' : 'viewer';
}

interface ResourceTables {
  ownerUserId: string | null;
  ownerOrgId: string | null;
  collaboratorRole: Role | null;
}

async function loadLayout(userId: string, id: string): Promise<ResourceTables | null> {
  const row = await db
    .select({
      ownerUserId: schema.layouts.ownerUserId,
      ownerOrgId: schema.layouts.ownerOrgId,
    })
    .from(schema.layouts)
    .where(eq(schema.layouts.id, id))
    .get();
  if (!row) return null;
  const collab = await db
    .select({ role: schema.layoutCollaborators.role })
    .from(schema.layoutCollaborators)
    .where(
      and(
        eq(schema.layoutCollaborators.layoutId, id),
        eq(schema.layoutCollaborators.userId, userId),
      ),
    )
    .get();
  return {
    ownerUserId: row.ownerUserId,
    ownerOrgId: row.ownerOrgId,
    collaboratorRole: (collab?.role as Role) ?? null,
  };
}

async function loadCustomPart(userId: string, id: string): Promise<ResourceTables | null> {
  const row = await db
    .select({
      ownerUserId: schema.customParts.ownerUserId,
      ownerOrgId: schema.customParts.ownerOrgId,
      isGlobal: schema.customParts.isGlobal,
    })
    .from(schema.customParts)
    .where(eq(schema.customParts.id, id))
    .get();
  if (!row) return null;
  const collab = await db
    .select({ role: schema.customPartCollaborators.role })
    .from(schema.customPartCollaborators)
    .where(
      and(
        eq(schema.customPartCollaborators.customPartId, id),
        eq(schema.customPartCollaborators.userId, userId),
      ),
    )
    .get();
  // Global parts are visible (viewer) to every authenticated user. That
  // is a floor, not an ownership grant: the real owner / org / explicit
  // collaborator rows still decide who can edit or delete. (Returning the
  // caller as `ownerUserId` here once made every user "owner" of every
  // global part.)
  return {
    ownerUserId: row.ownerUserId,
    ownerOrgId: row.ownerOrgId,
    collaboratorRole: strongerOf((collab?.role as Role) ?? null, row.isGlobal ? 'viewer' : null),
  };
}

async function loadModule(userId: string, id: string): Promise<ResourceTables | null> {
  const row = await db
    .select({
      ownerUserId: schema.modules.ownerUserId,
      ownerOrgId: schema.modules.ownerOrgId,
    })
    .from(schema.modules)
    .where(eq(schema.modules.id, id))
    .get();
  if (!row) return null;
  const collab = await db
    .select({ role: schema.moduleCollaborators.role })
    .from(schema.moduleCollaborators)
    .where(
      and(
        eq(schema.moduleCollaborators.moduleId, id),
        eq(schema.moduleCollaborators.userId, userId),
      ),
    )
    .get();
  return {
    ownerUserId: row.ownerUserId,
    ownerOrgId: row.ownerOrgId,
    collaboratorRole: (collab?.role as Role) ?? null,
  };
}

export async function resolveResourceRole(
  userId: string,
  kind: ResourceKind,
  resourceId: string,
): Promise<RoleResolution> {
  // Orgs are special: there's no separate ownership row + collaborators,
  // the membership table IS the access list. admin → owner, member →
  // editor. We short-circuit here rather than threading orgs through
  // the loadXxx helpers (which assume the resource has its own row).
  if (kind === 'org') {
    const membership = await db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, resourceId),
          eq(schema.orgMembers.userId, userId),
        ),
      )
      .get();
    if (!membership) return { role: null };
    // The club itself (its settings) is the admins'; managers run its things, not it.
    return { role: membership.role === 'admin' ? 'owner' : 'editor' };
  }

  let res: ResourceTables | null;
  switch (kind) {
    case 'layout':
      res = await loadLayout(userId, resourceId);
      break;
    case 'custom_part':
      res = await loadCustomPart(userId, resourceId);
      break;
    case 'module':
      res = await loadModule(userId, resourceId);
      break;
  }
  if (!res) return { role: null };

  let role: Role | null = null;

  if (res.ownerUserId === userId) {
    role = strongerOf(role, 'owner');
  }

  if (res.ownerOrgId) {
    const membership = await db
      .select({ role: schema.orgMembers.role, membersCanCreate: schema.orgs.membersCanCreate })
      .from(schema.orgMembers)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgMembers.orgId))
      .where(
        and(
          eq(schema.orgMembers.orgId, res.ownerOrgId),
          eq(schema.orgMembers.userId, userId),
        ),
      )
      .get();
    if (membership) {
      role = strongerOf(
        role,
        kind === 'module' ? clubModuleRole(membership.role, membership.membersCanCreate) : clubThingRole(membership.role),
      );
    }
  }

  if (res.collaboratorRole) role = strongerOf(role, res.collaboratorRole);

  // A restricted person's own things are frozen (privacy: restriction):
  // anyone who may see them still can, but nobody changes them.
  if (role !== null && role !== 'viewer' && res.ownerUserId && (await isRestricted(res.ownerUserId))) role = 'viewer';

  return { role };
}

async function isRestricted(userId: string): Promise<boolean> {
  const row = await db.select({ r: schema.users.restrictedAt }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return !!row?.r;
}

/** Convenience predicate: does the user have at least the given role? */
export function hasAtLeast(actual: Role | null, required: Role): boolean {
  if (actual === null) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
