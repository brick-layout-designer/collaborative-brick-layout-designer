// Connectivity against vanilla BlueBrick: rebuilding the links of maps
// that BlueBrick 1.9.2 saved must reproduce exactly the links it wrote.
// Needs the BlueBrickParts library at <repo>/parts-library, like
// scan.test.ts; skipped without it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { readBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';
import { rebuildConnectivity } from './connectivity.js';
import { scanCatalog } from './scan.js';
import type { Catalog } from './types.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PARTS = resolve(ROOT, 'parts-library/parts');
const FIXTURES = resolve(ROOT, 'packages/bbm/tests/fixtures');

function links(map: BbmMap): string[] {
  const out = new Set<string>();
  for (const l of map.layers) {
    if (l.type !== 'brick') continue;
    for (const b of l.bricks) for (const c of b.connexions) if (c.linkedTo) out.add([c.id, c.linkedTo].sort().join('|'));
  }
  return [...out].sort();
}

describe.skipIf(!existsSync(PARTS))('connectivity matches vanilla BlueBrick', () => {
  const files = [
    'tight-corner.bbm',
    'fordyce-2026.bbm',
    'oracle/fourdbrix.bbm',
    'oracle/fourdbrix.from-ncp.bbm',
    'oracle/tight-corner.from-ldr.bbm',
    'oracle/tight-corner.from-mpd.bbm',
    // Three brick layers: aligned points on different layers stay unlinked.
    'oracle/tight-corner.from-tdl.bbm',
  ];
  let catalog: Catalog;
  beforeAll(async () => {
    catalog = (await scanCatalog(PARTS)).catalog;
  }, 60_000);

  for (const file of files) {
    it(file, () => {
      const map = readBbm(readFileSync(resolve(FIXTURES, file), 'utf8')).map;
      const vanilla = links(map);
      rebuildConnectivity(map, catalog);
      expect(links(map)).toEqual(vanilla);
    });
  }
});
