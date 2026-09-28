import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBbm } from './Reader.js';
import { writeBbm } from './Writer.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');

const FIXTURE_FILES = ['tight-corner.bbm', 'fordyce-2026.bbm'];

describe('round-trip against vendored sample files', () => {
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

      // These files are the desktop's own byte-exact golden corpus
      // (brick-layout-designer/fixtures/bbm-corpus, enforced there by
      // RealFixtureTest::ByteExactRoundTrip), so desktop load + save
      // reproduces them exactly. The web writer must too.
      it('round-trips byte-for-byte (default options, nbItems recomputed)', () => {
        expect(writeBbm(parsed.map)).toBe(original);
      });

      it('round-trips byte-for-byte with nbItems preserved', () => {
        expect(writeBbm(parsed.map, { recomputeNbItems: false })).toBe(original);
      });

      it('round-trips: read → write → read produces equal models (semantic identity)', () => {
        const written = writeBbm(parsed.map);
        const reparsed = readBbm(written);
        // Ruler items get a fresh in-memory `id` on every read — desktop
        // does the same (`<LinearRuler>` / `<CircularRuler>` XML has no
        // id attribute upstream, so the guid is minted at parse time).
        // Strip the ids before comparing so equality is semantic.
        expect(stripRulerIds(reparsed.map)).toEqual(stripRulerIds(parsed.map));
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

function stripRulerIds(map: ReturnType<typeof readBbm>['map']): ReturnType<typeof readBbm>['map'] {
  return {
    ...map,
    layers: map.layers.map((layer) =>
      layer.type === 'ruler'
        ? {
            ...layer,
            rulerItems: layer.rulerItems.map(({ id: _id, ...rest }) => rest),
          }
        : layer,
    ),
  } as ReturnType<typeof readBbm>['map'];
}

// Files written by vanilla BlueBrick 1.9.2 itself (desktop
// fixtures/bluebrick-oracle), including its conversions of LDraw,
// TrackDesigner and 4DBrix maps. Vanilla writes exponents as "E-07".
describe('round-trip against vanilla BlueBrick output (oracle fixtures)', () => {
  const ORACLE = [
    'flex-a.bbm', 'flex-b.bbm', 'flex-c.bbm', 'flex-in.bbm', 'fourdbrix.bbm',
    'fourdbrix.from-ncp.bbm', 'tight-corner.from-ldr.bbm', 'tight-corner.from-mpd.bbm', 'tight-corner.from-tdl.bbm',
  ];
  for (const file of ORACLE) {
    it(`${file} round-trips byte-for-byte`, () => {
      const original = readFileSync(resolve(FIXTURES, 'oracle', file), 'utf8');
      const parsed = readBbm(original);
      expect(parsed.warnings).toEqual([]);
      // flex-in's stored nbItems is stale; vanilla recomputes on save.
      expect(writeBbm(parsed.map, { recomputeNbItems: false })).toBe(original);
    });
  }
});

describe('damaged numbers', () => {
  it('a non-numeric float reads as 0 and the map still saves (desktop XmlPrimitives.cpp:47-57)', () => {
    const original = readFileSync(resolve(FIXTURES, 'tight-corner.bbm'), 'utf8');
    for (const bad of ['abc', 'NaN', '-INF', '1e999']) {
      const damaged = original.replace(/<Orientation>[^<]*<\/Orientation>/, `<Orientation>${bad}</Orientation>`);
      const parsed = readBbm(damaged);
      const first = parsed.map.layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []))[0]!;
      expect(first.orientation).toBe(0);
      expect(() => writeBbm(parsed.map)).not.toThrow();
    }
  });
});
