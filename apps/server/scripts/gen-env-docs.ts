// Rewrites the configuration tables in the repository README from
// src/envDocs.ts: pnpm --filter @cld/server docs:env
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withEnvTables } from '../src/envDocs.js';

const readme = fileURLToPath(new URL('../../../README.md', import.meta.url));
writeFileSync(readme, withEnvTables(readFileSync(readme, 'utf8')));
console.log(`Updated ${readme}`);
