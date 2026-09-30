// Writes packages/bbm/tests/fixtures/web-made.bld-layout, which both apps'
// tests read: the desktop-made corner-lobby.bld-layout opened as the web
// opens it (the server gives the image a URL) and downloaded again.
//
//   npx tsx apps/web/scripts/make-web-made-layout.ts

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSidecar, writeSidecar } from '@cld/bbm';
import { buildLayoutFile, readLayoutFile } from '../src/layoutFile';

const fixtures = new URL('../../../packages/bbm/tests/fixtures/', import.meta.url);
const opened = await readLayoutFile(new Uint8Array(readFileSync(fileURLToPath(new URL('corner-lobby.bld-layout', fixtures)))));
const raw = JSON.parse(opened.sidecar!) as { backgroundImage: Record<string, unknown> };
raw.backgroundImage.url = '/api/layouts/00000000-0000-0000-0000-000000000000/background-image';
const bytes = await buildLayoutFile({ bbm: opened.bbm, sidecar: writeSidecar(readSidecar(JSON.stringify(raw))), background: opened.background! });
writeFileSync(fileURLToPath(new URL('web-made.bld-layout', fixtures)), bytes);
console.log(`wrote web-made.bld-layout (${bytes.length} bytes)`);
