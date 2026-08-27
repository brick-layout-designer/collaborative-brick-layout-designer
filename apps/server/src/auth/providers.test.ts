import { describe, expect, it } from 'vitest';
import { listProviders } from './providers.js';

describe('listProviders', () => {
  it('returns an array with google, github, and oidc entries', () => {
    const providers = listProviders();
    expect(Array.isArray(providers)).toBe(true);
    const ids = providers.map((p) => p.id);
    expect(ids).toContain('google');
    expect(ids).toContain('github');
    expect(ids).toContain('oidc');
  });

  it('each provider has id, label, and enabled fields', () => {
    const providers = listProviders();
    for (const p of providers) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(typeof p.enabled).toBe('boolean');
    }
  });

  it('providers are disabled when env vars are not set (test environment)', () => {
    const providers = listProviders();
    // In the test environment no OAuth env vars are configured.
    // All providers should be disabled.
    const google = providers.find((p) => p.id === 'google');
    const github = providers.find((p) => p.id === 'github');
    expect(google?.enabled).toBe(false);
    expect(github?.enabled).toBe(false);
  });
});
