import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './index.js';

migrate(db, { migrationsFolder: './migrations' });
sqlite.close();
console.log('migrations applied');
