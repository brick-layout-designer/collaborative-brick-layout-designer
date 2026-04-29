import { describe, expect, it } from 'vitest';
import { deterministicColor } from './awareness';

describe('deterministicColor', () => {
  it('returns the same colour for the same (user, layout) pair', () => {
    const a = deterministicColor('alice-id', 'layout-A');
    const b = deterministicColor('alice-id', 'layout-A');
    expect(a).toBe(b);
  });

  it('typically picks different colours for different users', () => {
    // Smoke test: across 100 user IDs we should see at least 3 of the 8
    // palette colours appear. (Exact distribution varies by hash.)
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(deterministicColor(`user-${i}`, 'layout-A'));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('returns different colours for the same user on different layouts', () => {
    // Most cases produce different colours, but the palette is small
    // (8 entries) so collisions exist. We assert the function ISN'T
    // identity-on-userId-only by trying many layouts.
    const layoutColors = new Set<string>();
    for (let i = 0; i < 30; i++) {
      layoutColors.add(deterministicColor('alice', `layout-${i}`));
    }
    expect(layoutColors.size).toBeGreaterThan(1);
  });

  it('always returns a hex colour string', () => {
    expect(deterministicColor('a', 'b')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
