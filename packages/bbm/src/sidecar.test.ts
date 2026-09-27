import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  readSidecar,
  writeSidecar,
  type Sidecar,
} from './sidecar.js';
import { hashBbmBytes } from './sidecarHash.js';

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

  it('overrides bbmHashSha256 when an explicit digest is supplied', () => {
    const stale = { ...baseSidecar, bbmHashSha256: 'STALE' };
    const fresh = hashBbmBytes('abc');
    const written = writeSidecar(stale, { bbmHashSha256: fresh });
    const parsed = JSON.parse(written) as { bbmHashSha256: string };
    expect(parsed.bbmHashSha256).toBe(fresh);
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

describe('backgroundImage', () => {
  it('maps the desktop shape {path, rect:[x,y,w,h]} to the web shape', () => {
    // Shape written by desktop SidecarIO.cpp writeSidecar.
    const raw = JSON.stringify({
      schemaVersion: 1,
      bbmHashSha256: '',
      backgroundImage: { opacity: 0.35, path: '/home/me/hall.png', rect: [-10, 20.5, 300, 150] },
    });
    const parsed = readSidecar(raw);
    expect(parsed.backgroundImage).toEqual({
      url: '',
      path: '/home/me/hall.png',
      opacity: 0.35,
      rect: { x: -10, y: 20.5, w: 300, h: 150 },
    });
    expect(parsed.extras).toBeUndefined();
  });

  it('defaults opacity to 0.5 and omits rect when absent (desktop defaults)', () => {
    const parsed = readSidecar(
      JSON.stringify({ schemaVersion: 1, backgroundImage: { path: 'bg.jpg' } }),
    );
    expect(parsed.backgroundImage).toEqual({ url: '', path: 'bg.jpg', opacity: 0.5 });
  });

  it('reads the web shape {url, rect:{x,y,w,h}}', () => {
    const bg = { url: '/api/layouts/L1/background-image', opacity: 0.8, rect: { x: 1, y: 2, w: 3, h: 4 } };
    const parsed = readSidecar(JSON.stringify({ schemaVersion: 1, backgroundImage: bg }));
    expect(parsed.backgroundImage).toEqual(bg);
  });

  it('writes backgroundImage (previously dropped) in a shape both apps read', () => {
    const bg = { url: '/api/layouts/L1/background-image', opacity: 0.8, rect: { x: 1, y: 2, w: 3, h: 4 } };
    const written = writeSidecar({ ...baseSidecar, backgroundImage: bg });
    const json = JSON.parse(written) as { backgroundImage: { rect: unknown } };
    // Desktop only understands a 4-element rect array.
    expect(json.backgroundImage.rect).toEqual([1, 2, 3, 4]);
    expect(readSidecar(written).backgroundImage).toEqual(bg);
  });

  it('round-trips a desktop sidecar without losing path', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      bbmHashSha256: '',
      backgroundImage: { opacity: 0.5, path: 'C:/maps/hall.png', rect: [0, 0, 10, 10] },
    });
    const json = JSON.parse(writeSidecar(readSidecar(raw))) as { backgroundImage: unknown };
    expect(json.backgroundImage).toEqual({
      opacity: 0.5,
      path: 'C:/maps/hall.png',
      rect: [0, 0, 10, 10],
      url: '',
    });
  });

  it('ignores a backgroundImage with neither url nor path', () => {
    const parsed = readSidecar(JSON.stringify({ schemaVersion: 1, backgroundImage: { opacity: 1 } }));
    expect(parsed.backgroundImage).toBeUndefined();
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
