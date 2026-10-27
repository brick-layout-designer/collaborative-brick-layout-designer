import type { ClubRoleSummary, OrgMemberSummary } from '../api';

// Club roles, strongest first (the server's access/clubRoles.ts):
// Admin runs the club, Manager runs its day to day, Member uses it.

export type ClubRole = 'admin' | 'manager' | 'member';

export const CLUB_ROLES: { value: ClubRole; label: string; line: string }[] = [
  { value: 'admin', label: 'Admin', line: 'Everything: club settings, roles, handing over and deleting the club.' },
  { value: 'manager', label: 'Manager', line: 'Invites people, answers requests, removes members and looks after the club’s things.' },
  { value: 'member', label: 'Member', line: 'Uses and adds the club’s layouts, venues, modules and parts.' },
];

const RANK: Record<ClubRole, number> = { member: 1, manager: 2, admin: 3 };

/** Whether `role` is `min` or stronger. */
export function atLeast(role: ClubRole | null | undefined, min: ClubRole): boolean {
  return role ? RANK[role] >= RANK[min] : false;
}

export const roleLabel = (role: ClubRole) => CLUB_ROLES.find((r) => r.value === role)?.label ?? 'Member';

/** "an admin", "a manager", "a member". */
export const aRole = (role: ClubRole) => (role === 'admin' ? 'an admin' : role === 'manager' ? 'a manager' : 'a member');

const BUILTIN_A: Record<string, string> = { admin: 'an admin', manager: 'a manager', member: 'a member', viewer: 'a viewer' };

/**
 * What the club lists say about you: "you are a viewer", or, holding
 * roles of the club's own, "your roles: Viewer, Track crew". Older
 * servers send no role names: the strongest fixed role.
 */
export function yourRolesText(o: { myRole: ClubRole; roleNames?: string[] }): string {
  const names = o.roleNames ?? [];
  if (names.length === 0) return `you are ${aRole(o.myRole)}`;
  if (names.length === 1 && BUILTIN_A[names[0]!.toLowerCase()]) return `you are ${BUILTIN_A[names[0]!.toLowerCase()]}`;
  return `${names.length === 1 ? 'your role' : 'your roles'}: ${names.join(', ')}`;
}

/**
 * The Manage page's line about you: "You’re a viewer of this club." for
 * one of the four roles a club starts with, else "Your roles: Viewer,
 * Track crew." Older servers send no role names: the strongest fixed role.
 */
export function yourRolesSentence(o: { myRole: ClubRole; roleNames?: string[] }): string {
  const names = o.roleNames ?? [];
  if (names.length === 0) return `You’re ${aRole(o.myRole)} of this club.`;
  const a = names.length === 1 ? BUILTIN_A[names[0]!.toLowerCase()] : undefined;
  if (a) return `You’re ${a} of this club.`;
  return `${names.length === 1 ? 'Your role' : 'Your roles'}: ${names.join(', ')}.`;
}

/**
 * How an invite says the role it gives: "as a viewer" (one of the four a
 * club starts with), "with the role Track crew" (a club's own), or, from
 * an older server, the fixed role.
 */
export function asRole(role: ClubRole, roleName?: string | null): string {
  if (!roleName) return `as ${aRole(role)}`;
  const builtin: Record<string, string> = { admin: 'an admin', manager: 'a manager', member: 'a member', viewer: 'a viewer' };
  const a = builtin[roleName.toLowerCase()];
  return a ? `as ${a}` : `with the role ${roleName}`;
}

/** Strongest first, for member lists. */
export const byRole = (a: ClubRole, b: ClubRole) => RANK[b] - RANK[a];

/**
 * Member lists, strongest first: anyone holding the Admin role, then by how
 * many permissions their roles grant together, then by name. The desktop's
 * Members view sorts the same way (ClubMembers::sorted). Without club roles
 * (an older server), the fixed role, then the name.
 */
export function byStrongestRole(roles: ClubRoleSummary[] | undefined): (a: OrgMemberSummary, b: OrgMemberSummary) => number {
  const byId = new Map((roles ?? []).map((r) => [r.id, r]));
  const withRoles = byId.size > 0;
  const rank = (m: OrgMemberSummary): [number, number] => {
    const held = (m.roleIds ?? []).flatMap((id) => byId.get(id) ?? []);
    return [held.some((r) => r.key === 'admin') ? 1 : 0, new Set(held.flatMap((r) => r.permissions)).size];
  };
  return (a, b) => {
    if (withRoles && Array.isArray(a.roleIds) && Array.isArray(b.roleIds)) {
      const [aAdmin, aPerms] = rank(a);
      const [bAdmin, bPerms] = rank(b);
      if (aAdmin !== bAdmin) return bAdmin - aAdmin;
      if (aPerms !== bPerms) return bPerms - aPerms;
    } else {
      const r = byRole(a.role, b.role);
      if (r) return r;
    }
    return a.displayName.localeCompare(b.displayName);
  };
}

/** The names of the roles a member holds, in the club's order (empty without club roles). */
export function memberRoleNames(m: OrgMemberSummary, roles: ClubRoleSummary[] | undefined): string[] {
  const held = new Set(m.roleIds ?? []);
  return [...(roles ?? [])].sort((a, b) => a.position - b.position).filter((r) => held.has(r.id)).map((r) => r.name);
}
