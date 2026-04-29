import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  hashBbmBytes,
  readSidecar,
  writeSidecar,
  type Sidecar,
} from './sidecar.js';

const baseSidecar: Sidecar = {
  schemaVersion: 1,
  bbmHashSha256: '',
  anchoredLabels: [],
  modules: [],
};

describe('readSidecar', () => {
  it('parses a minimal sidecar', () => {
    const result = readSidecar(JSON.stringify({ schemaVersion: 1, bbmHashSha256: 'abc' }));
    expect(result.schemaVersion).toBe(1);
    expect(result.bbmHashSha256).toBe('abc');
  });

  it('treats missing bbmHashSha256 as empty (initial-state, hash detection skipped)', () => {
    const result = readSidecar(JSON.stringify({ schemaVersion: 1 }));
    expect(result.bbmHashSha256).toBe('');
  });

  it('rejects schemaVersion newer than supported', () => {
    expect(() =>
      readSidecar(JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })),
    ).toThrow(/schemaVersion/);
  });

  it('preserves unknown top-level fields in extras', () => {
    const raw = JSON.stringify({ schemaVersion: 1, bbmHashSha256: '', futureField: { x: 1 } });
    const parsed = readSidecar(raw);
    expect(parsed.extras).toEqual({ futureField: { x: 1 } });
  });
});

describe('writeSidecar', () => {
  it('round-trips through JSON.parse / readSidecar', () => {
    const written = writeSidecar(baseSidecar);
    expect(readSidecar(written)).toEqual(baseSidecar);
  });

  it('emits 2-space-indented JSON by default', () => {
    const written = writeSidecar(baseSidecar);
    expect(written).toContain('\n  "schemaVersion": 1');
  });

  it('overrides bbmHashSha256 when bbmBytes is supplied', () => {
    const stale = { ...baseSidecar, bbmHashSha256: 'STALE' };
    const written = writeSidecar(stale, { bbmBytes: 'abc' });
    const parsed = JSON.parse(written) as { bbmHashSha256: string };
    expect(parsed.bbmHashSha256).toBe(hashBbmBytes('abc'));
    expect(parsed.bbmHashSha256).not.toBe('STALE');
  });

  it('preserves unknown extras on round-trip', () => {
    const sidecar: Sidecar = {
      ...baseSidecar,
      extras: { somethingNew: { nested: true } },
    };
    const written = writeSidecar(sidecar);
    const parsed = readSidecar(written);
    expect(parsed.extras).toEqual({ somethingNew: { nested: true } });
  });
});

describe('hashBbmBytes', () => {
  it('produces lowercase hex', () => {
    const h = hashBbmBytes('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches a known SHA-256 value', () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(hashBbmBytes('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts both string and Uint8Array', () => {
    const s = hashBbmBytes('hello');
    const b = hashBbmBytes(new TextEncoder().encode('hello'));
    expect(s).toBe(b);
  });
});
