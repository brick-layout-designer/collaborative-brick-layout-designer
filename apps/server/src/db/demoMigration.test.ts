// Migration 0019 (the demo account): on a database at 0018 that still has
// per-person demo accounts and expiring demo layouts, it clears every demo
// flag and expiry, deletes nobody and nothing, and leaves the new demo
// switch off.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The migrations folder as it was up to and including `lastTag`. */
function migrationsUpTo(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cld-mig-'));
  dirs.push(dir);
  cpSync('migrations', dir, { recursive: true });
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const end = journal.entries.findIndex((e) => e.tag === lastTag);
  journal.entries = journal.entries.slice(0, end + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0019_demo_account', () => {
  it('clears every demo flag and layout expiry without deleting anyone or anything', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cld-mig-db-'));
    dirs.push(dir);
    const sqlite = new Database(join(dir, 'db.sqlite'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo('0018_warnings') });

    const now = Date.now();
    const user = sqlite.prepare(
      'INSERT INTO users (id, email, display_name, is_demo_account, is_global_admin, is_moderator, email_verified, created_at) VALUES (?, ?, ?, ?, 0, 0, 1, ?)',
    );
    user.run('u-demo', 'demo@example.com', 'Old demo', 1, now);
    user.run('u-real', 'real@example.com', 'Real', 0, now);
    const layout = sqlite.prepare(
      'INSERT INTO layouts (id, title, owner_user_id, created_by, created_at, updated_at, expires_at, doc_snapshot, doc_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
    );
    layout.run('l-demo', 'Demo layout', 'u-demo', 'u-demo', now, now, now + 86_400_000, Buffer.from([0]));
    layout.run('l-real', 'Real layout', 'u-real', 'u-real', now, now, null, Buffer.from([0]));
    sqlite.prepare("INSERT INTO platform_settings (id, updated_at) VALUES ('singleton', ?)").run(now);

    migrate(db, { migrationsFolder: 'migrations' });

    const users = sqlite.prepare('SELECT id, is_demo_account AS demo FROM users ORDER BY id').all();
    expect(users).toEqual([{ id: 'u-demo', demo: 0 }, { id: 'u-real', demo: 0 }]);
    const layouts = sqlite.prepare('SELECT id, expires_at AS exp FROM layouts ORDER BY id').all();
    expect(layouts).toEqual([{ id: 'l-demo', exp: null }, { id: 'l-real', exp: null }]);
    const settings = sqlite.prepare('SELECT demo_enabled AS on_, demo_reset_every AS every, demo_last_reset_at AS last FROM platform_settings').get();
    expect(settings).toEqual({ on_: 0, every: 'daily', last: null });
    sqlite.close();
  });
});
