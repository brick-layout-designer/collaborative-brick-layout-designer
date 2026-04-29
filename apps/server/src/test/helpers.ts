import { db, schema, sqlite } from '../db/index.js';

/**
 * Truncate everything between tests. Order matters: child rows first.
 * SQLite has no TRUNCATE; DELETE without a WHERE clause is the equivalent.
 */
export function resetDb(): void {
  sqlite.exec(`
    DELETE FROM layout_updates;
    DELETE FROM layout_invites;
    DELETE FROM layout_collaborators;
    DELETE FROM layouts;
    DELETE FROM oauth_accounts;
    DELETE FROM org_members;
    DELETE FROM orgs;
    DELETE FROM sessions;
    DELETE FROM users;
  `);
}

export { db, schema };
