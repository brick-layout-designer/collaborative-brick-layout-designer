import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readBbm } from '@cld/bbm';
import { bbmToDoc, docToBbm } from './projection.js';

// Same vendored sample `.bbm` files as packages/bbm uses. Symlinking into
// ydoc would be finicky in CI; just navigate up to the bbm package.
const BBM_FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../bbm/tests/fixtures',
);

describe('bbmToDoc / docToBbm round-trip', () => {
  for (const fixture of ['tight-corner.bbm', 'fordyce-2026.bbm']) {
    it(`preserves the model on ${fixture}`, () => {
      const xml = readFileSync(resolve(BBM_FIXTURES, fixture), 'utf8');
      const original = readBbm(xml).map;

      const doc = new Y.Doc();
      bbmToDoc(original, doc);

      const reconstructed = docToBbm(doc);
      expect(reconstructed).toEqual(original);
    });
  }

  it('writes a deterministic snapshot — round-tripping after applyUpdate is identical', () => {
    // Critical for the persistence layer: the server stores the binary
    // y-update bytes and reconstructs by `applyUpdate(new Doc, bytes)`.
    // That path must match the in-memory shape exactly, otherwise an
    // edit → save → reload cycle would silently lose data.
    const xml = readFileSync(resolve(BBM_FIXTURES, 'tight-corner.bbm'), 'utf8');
    const original = readBbm(xml).map;

    const a = new Y.Doc();
    bbmToDoc(original, a);
    const update = Y.encodeStateAsUpdate(a);

    const b = new Y.Doc();
    Y.applyUpdate(b, update);
    expect(docToBbm(b)).toEqual(original);
  });
});

describe('bbmToDoc semantics', () => {
  it('replaces prior layer state on a second call (does not merge)', () => {
    const xml = readFileSync(resolve(BBM_FIXTURES, 'tight-corner.bbm'), 'utf8');
    const tight = readBbm(xml).map;

    const doc = new Y.Doc();
    bbmToDoc(tight, doc);
    bbmToDoc(tight, doc); // second call should replace, not duplicate

    const out = docToBbm(doc);
    expect(out.layers.length).toBe(tight.layers.length);
  });
});
