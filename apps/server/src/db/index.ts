import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../env.js';
import * as schema from './schema.js';

const dir = dirname(env.dbPath);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

export const sqlite = new Database(env.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

export const db = drizzle(sqlite, { schema });
export { schema };
