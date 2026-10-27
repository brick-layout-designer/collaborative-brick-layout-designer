// Direct SQLite access for e2e tests that need server-side state the
// browser can't reach — currently just the email-verification token,
// which in real use only ever reaches the user via an email Playwright
// can't receive. Opens the same DB_PATH the running server was started
// with (see playwright.config.ts's header comment for the expected env).
//
// Mostly read-only. The exceptions: a verification link's token is set
// to a known value (the server keeps only its hash), and tests that
// simulate token expiry UPDATE a row's expires_at directly — there's no
// API surface for that and it's the standard way to test expiry without
// sleeping the test for real.

import { createHash, randomBytes } from 'node:crypto';
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
 * A working email-verification link token for a user, by email. The
 * server keeps only the token's sha256 (the raw token is only ever
 * emailed), so this gives the user's live verification row a fresh token
 * and returns it, the way the emailed link would carry it. The row stays
 * the same otherwise (still tied to the browser that signed up, if it
 * was). Polls briefly since the register request may return to the test
 * before the write is visible to a fresh connection in rare cases.
 */
export async function getVerificationToken(email: string): Promise<string> {
  const db = new Database(dbPath());
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const row = db
        .prepare(
          `SELECT ev.id AS id
           FROM email_verifications ev
           JOIN users u ON u.id = ev.user_id
           WHERE u.email = ?
           ORDER BY ev.created_at DESC
           LIMIT 1`,
        )
        .get(email) as { id: string } | undefined;
      if (row) {
        const token = randomBytes(24).toString('hex');
        db.prepare(`UPDATE email_verifications SET token = ? WHERE id = ?`).run(
          createHash('sha256').update(token).digest('hex'),
          row.id,
        );
        return token;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no verification token found for ${email} after polling`);
  } finally {
    db.close();
  }
}

/** Whether an account exists for `email`, and whether its email is confirmed. */
export function accountState(email: string): 'none' | 'unverified' | 'verified' {
  const db = new Database(dbPath(), { readonly: true });
  try {
    const row = db.prepare(`SELECT email_verified AS v FROM users WHERE email = ?`).get(email) as { v: number } | undefined;
    return !row ? 'none' : row.v ? 'verified' : 'unverified';
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

/** Make `email` a platform admin (there is no API for the first admin; real servers use BOOTSTRAP_ADMIN_EMAIL). */
export function makeGlobalAdmin(email: string): void {
  const db = new Database(dbPath());
  try {
    db.prepare(`UPDATE users SET is_global_admin = 1 WHERE email = ?`).run(email);
  } finally {
    db.close();
  }
}

/** Give an account a stored name directly, as older accounts got their email as their name. */
export function setStoredName(email: string, name: string): void {
  const db = new Database(dbPath());
  try {
    db.prepare(`UPDATE users SET display_name = ? WHERE email = ?`).run(name, email);
  } finally {
    db.close();
  }
}

/** Drop a module's picture, as if it was saved before modules had pictures. */
/** Give a module an old-style picture (a 256 px PNG), as made before pictures were 1024 px. */
export function setOldModuleThumbnail(moduleId: string, png: Buffer): void {
  const db = new Database(dbPath());
  try {
    db.prepare(`UPDATE modules SET thumbnail = ?, thumbnail_mime = 'image/png', thumbnail_at = ? WHERE id = ?`).run(png, Date.now(), moduleId);
  } finally {
    db.close();
  }
}

export function clearModuleThumbnail(moduleId: string): void {
  const db = new Database(dbPath());
  try {
    db.prepare(`UPDATE modules SET thumbnail = NULL, thumbnail_mime = NULL, thumbnail_at = NULL WHERE id = ?`).run(moduleId);
  } finally {
    db.close();
  }
}

type SmtpRow = { smtp_host: string | null; smtp_port: number | null; smtp_user: string | null; smtp_pass: string | null; smtp_from: string | null };

/**
 * Point the site's email at `to` (a local mail sink, e2e/mailSink.ts),
 * as Admin › Settings › Email would, and return a function that puts the
 * previous setting back. The server reads this row on every send.
 */
export function useSmtp(to: { host: string; port: number; from: string }): () => void {
  const db = new Database(dbPath());
  try {
    db.prepare(`INSERT OR IGNORE INTO platform_settings (id, require_email_verification) VALUES ('singleton', 1)`).run();
    const before = db.prepare(`SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from FROM platform_settings WHERE id = 'singleton'`).get() as SmtpRow;
    db.prepare(`UPDATE platform_settings SET smtp_host = ?, smtp_port = ?, smtp_user = NULL, smtp_pass = NULL, smtp_from = ? WHERE id = 'singleton'`).run(to.host, to.port, to.from);
    return () => {
      const again = new Database(dbPath());
      try {
        again
          .prepare(`UPDATE platform_settings SET smtp_host = ?, smtp_port = ?, smtp_user = ?, smtp_pass = ?, smtp_from = ? WHERE id = 'singleton'`)
          .run(before.smtp_host, before.smtp_port, before.smtp_user, before.smtp_pass, before.smtp_from);
      } finally {
        again.close();
      }
    };
  } finally {
    db.close();
  }
}
