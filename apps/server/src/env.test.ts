import { afterEach, describe, expect, it, vi } from 'vitest';

// env.ts reads process.env once at import time, so each test re-imports the
// module under fresh env. vi.resetModules() drops the cached copy.
const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

async function loadEnv() {
  vi.resetModules();
  return (await import('./env.js')).env;
}

describe('env', () => {
  it('disables every OAuth provider when no env is set', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.OIDC_ISSUER_URL;

    const env = await loadEnv();
    expect(env.google).toBeNull();
    expect(env.github).toBeNull();
    expect(env.oidc).toBeNull();
  });

  it('only enables a provider when both id AND secret are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    let env = await loadEnv();
    expect(env.google).toBeNull();

    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    env = await loadEnv();
    expect(env.google).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('OIDC requires issuer + id + secret all set', async () => {
    process.env.OIDC_ISSUER_URL = 'https://issuer.example';
    process.env.OIDC_CLIENT_ID = 'cid';
    delete process.env.OIDC_CLIENT_SECRET;
    let env = await loadEnv();
    expect(env.oidc).toBeNull();

    process.env.OIDC_CLIENT_SECRET = 'csecret';
    env = await loadEnv();
    expect(env.oidc?.issuerUrl).toBe('https://issuer.example');
  });

  it('SMTP needs host + from to enable', async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    let env = await loadEnv();
    expect(env.smtp).toBeNull();

    process.env.SMTP_HOST = 'mail.example';
    process.env.SMTP_FROM = 'noreply@example';
    env = await loadEnv();
    expect(env.smtp?.host).toBe('mail.example');
    expect(env.smtp?.port).toBe(587); // default
  });

  it('boolean envs accept "true" and "1"', async () => {
    process.env.ENABLE_PASSWORD_AUTH = '1';
    let env = await loadEnv();
    expect(env.enablePasswordAuth).toBe(true);

    process.env.ENABLE_PASSWORD_AUTH = 'true';
    env = await loadEnv();
    expect(env.enablePasswordAuth).toBe(true);

    process.env.ENABLE_PASSWORD_AUTH = 'no';
    env = await loadEnv();
    expect(env.enablePasswordAuth).toBe(false);
  });
});
