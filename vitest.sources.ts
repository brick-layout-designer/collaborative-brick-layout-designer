// Tests read the workspace packages (@cld/bbm, @cld/model, ...) from their
// sources, not from their built dist/ folders. A dist/ left over from an
// older checkout made tests fail locally while CI, which builds first,
// passed. Each package's exports name the source file under "types".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Alias {
  find: RegExp;
  replacement: string;
}

const packagesDir = fileURLToPath(new URL('./packages', import.meta.url));

export function workspaceSources(): Alias[] {
  const out: Alias[] = [];
  for (const dir of readdirSync(packagesDir)) {
    const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8')) as {
      name: string;
      exports?: Record<string, { types: string }>;
    };
    for (const [path, target] of Object.entries(pkg.exports ?? {})) {
      const name = path === '.' ? pkg.name : `${pkg.name}/${path.slice(2)}`;
      out.push({ find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`), replacement: join(packagesDir, dir, target.types) });
    }
  }
  return out;
}
