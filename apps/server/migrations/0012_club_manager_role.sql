-- Club roles gain 'manager', between 'admin' and 'member'. The role columns
-- (org_members.role, org_invites.role) are plain text in SQLite; only the
-- app's enum widens, so no row changes: admins and members keep exactly the
-- access they have.
SELECT 1;
