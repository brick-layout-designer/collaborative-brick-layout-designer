import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanCatalog } from './scan.js';

// Path to the BlueBrickParts submodule. The scan test exercises the real
// vendored library to catch regressions in dispatching `.set.xml` vs `.xml`,
// finding sibling sprites, and surfacing parser errors as warnings.
const PARTS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../parts-library/parts',
);

describe('scanCatalog (against vendored BlueBrickParts)', () => {
  it('finds a substantial number of leaf parts', async () => {
    const result = await scanCatalog(PARTS_ROOT);

    expect(result.catalog.size).toBeGreaterThan(500);
    // The library should contain TS_CURVE_R56.8 — used as the headline
    // example in the survey + parser test.
    expect(result.catalog.has('ts_curve_r56.8')).toBe(true);

    const curve = result.catalog.get('ts_curve_r56.8');
    expect(curve?.partNumber).toBe('TS_CURVE_R56');
    expect(curve?.colorCode).toBe('8');
    expect(curve?.connections).toHaveLength(2);
  });

  it('pairs XML files with their matching sprites', async () => {
    const { catalog } = await scanCatalog(PARTS_ROOT);
    const curve = catalog.get('ts_curve_r56.8');
    // The sibling .gif lives at parts/4DBrix/TS_CURVE_R56.8.gif.
    expect(curve?.spritePath).toMatch(/TS_CURVE_R56\.8\.gif$/);
  });

  it('emits a useful diagnostic instead of crashing on malformed XML', async () => {
    const result = await scanCatalog(PARTS_ROOT);
    // The vendored library may have some legitimately-broken files; we
    // never want a single bad file to abort the whole scan.
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
