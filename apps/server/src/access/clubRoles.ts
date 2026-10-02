// Club roles, strongest first:
//   - 'admin'   everything: club settings, roles, handing over, deleting it
//   - 'manager' day-to-day running: invites, join requests, removing
//               members, and the club's layouts, venues, modules and parts
//   - 'member'  uses and adds the club's things
// The last-admin rule counts admins only.

export const CLUB_ROLES = ['admin', 'manager', 'member'] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

const RANK: Record<ClubRole, number> = { member: 1, manager: 2, admin: 3 };

export function isClubRole(v: unknown): v is ClubRole {
  return typeof v === 'string' && (CLUB_ROLES as readonly string[]).includes(v);
}

/** Whether `role` is `min` or stronger. */
export function atLeast(role: ClubRole | null | undefined, min: ClubRole): boolean {
  return role ? RANK[role] >= RANK[min] : false;
}

/** A club member's role on the club's things: managers and admins own them, members edit. */
export function clubThingRole(role: ClubRole): 'owner' | 'editor' {
  return atLeast(role, 'manager') ? 'owner' : 'editor';
}
