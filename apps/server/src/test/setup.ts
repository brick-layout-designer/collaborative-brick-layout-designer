import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';

// Each test run gets its own SQLite file in a temp dir so parallel CI jobs
// can't tread on each other and assertions start from a clean schema.
const dir = mkdtempSync(join(tmpdir(), 'cld-test-'));
process.env.DB_PATH = join(dir, 'test.sqlite');
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.PUBLIC_URL = 'http://localhost:3000';
process.env.ENABLE_PASSWORD_AUTH = 'true';

beforeAll(async () => {
  // Apply migrations once for the suite. Server module reads env.DB_PATH on
  // first import, so we import the migrator AFTER setting the env above.
  const { db } = await import('../db/index.js');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: 'migrations' });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
