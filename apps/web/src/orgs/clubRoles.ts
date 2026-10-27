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
