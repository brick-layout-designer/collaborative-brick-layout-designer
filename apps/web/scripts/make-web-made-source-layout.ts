// Writes packages/bbm/tests/fixtures/web-made-source.bld-layout: tight-corner.bbm
// saved by the web as server layout L-42 on collab.example.org, with a
// manifest field neither app knows. The desktop has the same file
// (fixtures/layouts/) and reads it. Run: npx tsx scripts/make-web-made-source-layout.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { buildLayoutFile } from '../src/layoutFile';
const root = new URL("../../../packages/bbm/tests/fixtures", import.meta.url).pathname;
const bbm = readFileSync(`${root}/tight-corner.bbm`, 'utf8');
const bytes = await buildLayoutFile({
  bbm,
  sidecar: null,
  source: { server: 'https://collab.example.org', layoutId: 'L-42', title: 'Show 2026', exportedAt: '2026-10-01T12:00:00.000Z' },
  keepManifest: { futureField: { kept: true } },
});
writeFileSync(`${root}/web-made-source.bld-layout`, bytes);
console.log('wrote', bytes.length);
