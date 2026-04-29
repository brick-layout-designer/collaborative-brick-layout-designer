// Generic access-control helper used by REST handlers AND (later) the WS
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

import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

export type Role = 'owner' | 'editor' | 'viewer';
export type ResourceKind = 'layout';
// Phase 6.5 will add 'custom_part' | 'module'. Keeping this as a discriminated
// kind from day one so the handler signatures don't need to change later.

export interface RoleResolution {
  role: Role | null;
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
function strongerOf(a: Role | null, b: Role | null): Role | null {
  if (a === null) return b;
  if (b === null) return a;
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export async function resolveResourceRole(
  userId: string,
  kind: ResourceKind,
  resourceId: string,
): Promise<RoleResolution> {
  if (kind !== 'layout') {
    throw new Error(`unsupported resource kind: ${kind as string}`);
  }

  const layout = await db
    .select({
      ownerUserId: schema.layouts.ownerUserId,
      ownerOrgId: schema.layouts.ownerOrgId,
    })
    .from(schema.layouts)
    .where(eq(schema.layouts.id, resourceId))
    .get();
  if (!layout) return { role: null };

  let role: Role | null = null;

  if (layout.ownerUserId === userId) {
    role = strongerOf(role, 'owner');
  }

  if (layout.ownerOrgId) {
    const membership = await db
      .select({ role: schema.orgMembers.role })
      .from(schema.orgMembers)
      .where(
        and(
          eq(schema.orgMembers.orgId, layout.ownerOrgId),
          eq(schema.orgMembers.userId, userId),
        ),
      )
      .get();
    if (membership) {
      role = strongerOf(role, membership.role === 'admin' ? 'owner' : 'editor');
    }
  }

  const explicitShare = await db
    .select({ role: schema.layoutCollaborators.role })
    .from(schema.layoutCollaborators)
    .where(
      and(
        eq(schema.layoutCollaborators.layoutId, resourceId),
        eq(schema.layoutCollaborators.userId, userId),
      ),
    )
    .get();
  if (explicitShare) role = strongerOf(role, explicitShare.role);

  return { role };
}

/** Convenience predicate: does the user have at least the given role? */
export function hasAtLeast(actual: Role | null, required: Role): boolean {
  if (actual === null) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}
