// Direct SQLite access for e2e tests that need server-side state the
// browser can't reach — currently just the email-verification token,
// which in real use only ever reaches the user via an email Playwright
// can't receive. Opens the same DB_PATH the running server was started
// with (see playwright.config.ts's header comment for the expected env).
//
// Read-only spirit: we only SELECT here. The one exception is tests that
// need to simulate token expiry, which UPDATE a row's expires_at
// directly — there's no API surface for that and it's the standard way
// to test expiry without sleeping the test for real.

import { resolve } from 'node:path';
import Database from 'better-sqlite3';

function dbPath(): string {
  const configured = process.env.DB_PATH;
  if (configured) return configured;
  // Matches apps/server/src/env.ts's own default, resolved relative to
  // apps/server (where the dev server process actually runs from).
  return resolve(import.meta.dirname, '../../server/data/cbld.sqlite');
}

/**
 * Look up the live (unconsumed) email-verification token for a user by
 * email. Polls briefly since the register request may return to the
 * test before the write is visible to a fresh connection in rare cases.
 */
export async function getVerificationToken(email: string): Promise<string> {
  const db = new Database(dbPath(), { readonly: true });
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const row = db
        .prepare(
          `SELECT ev.token AS token
           FROM email_verifications ev
           JOIN users u ON u.id = ev.user_id
           WHERE u.email = ?
           ORDER BY ev.created_at DESC
           LIMIT 1`,
        )
        .get(email) as { token: string } | undefined;
      if (row) return row.token;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no verification token found for ${email} after polling`);
  } finally {
    db.close();
  }
}

/** Force a user's live verification token to already be expired, for testing the expired-link path. */
export async function expireVerificationToken(email: string): Promise<void> {
  const db = new Database(dbPath());
  try {
    db.prepare(
      `UPDATE email_verifications
       SET expires_at = ?
       WHERE user_id = (SELECT id FROM users WHERE email = ?)`,
    ).run(Date.now() - 1000, email);
  } finally {
    db.close();
  }
}
