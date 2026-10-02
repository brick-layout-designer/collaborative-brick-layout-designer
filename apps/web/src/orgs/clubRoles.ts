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

/** Strongest first, for member lists. */
export const byRole = (a: ClubRole, b: ClubRole) => RANK[b] - RANK[a];
