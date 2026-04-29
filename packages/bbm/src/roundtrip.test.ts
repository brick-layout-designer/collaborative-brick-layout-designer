import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBbm } from './Reader.js';
import { writeBbm } from './Writer.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');

const FIXTURE_FILES = ['tight-corner.bbm', 'fordyce-2026.bbm'];

describe('round-trip against vendored corpus', () => {
  for (const file of FIXTURE_FILES) {
    describe(file, () => {
      const original = readFileSync(resolve(FIXTURES, file), 'utf8');
      const parsed = readBbm(original);

      it('parses without warnings', () => {
        expect(parsed.warnings).toEqual([]);
      });

      it('preserves the format version', () => {
        expect(parsed.map.version).toBe(9);
      });

      it('round-trips: read → write → read produces equal models (semantic identity)', () => {
        // We pass `recomputeNbItems: false` because the writer's recompute
        // would drop the (currently unported) ruler-item count. Preserving
        // the original value is the right call for unmodified imports —
        // that's also what the desktop does when it reads + immediately
        // re-saves a file. When ruler items are ported we can flip this on.
        const written = writeBbm(parsed.map, { recomputeNbItems: false });
        const reparsed = readBbm(written);
        expect(reparsed.map).toEqual(parsed.map);
      });

      it('output uses CRLF line endings', () => {
        const written = writeBbm(parsed.map);
        expect(written.split('\r\n').length).toBeGreaterThan(10);
        // No bare LF allowed
        expect(/(?<!\r)\n/.test(written)).toBe(false);
      });

      it('output starts with the canonical prolog', () => {
        const written = writeBbm(parsed.map);
        expect(written.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n')).toBe(true);
      });

      it('output has no trailing newline', () => {
        const written = writeBbm(parsed.map);
        expect(written.endsWith('</Map>')).toBe(true);
      });
    });
  }
});
