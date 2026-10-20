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

describe('TRUST_PROXY', () => {
  it('defaults to not trusting forwarded headers', async () => {
    delete process.env.TRUST_PROXY;
    expect((await loadEnv()).trustProxy).toBe(false);
  });

  it('parses booleans and address lists, and rejects hop counts', async () => {
    const { parseTrustProxy } = await import('./env.js');
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(() => parseTrustProxy('2')).toThrow(/hop counts/);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toBe('10.0.0.0/8, 127.0.0.1');
  });

  it('makes req.ip honour X-Forwarded-For only when enabled', async () => {
    const { default: Fastify } = await import('fastify');
    const { parseTrustProxy } = await import('./env.js');
    for (const [setting, expected] of [
      ['false', '127.0.0.1'],
      ['127.0.0.1', '203.0.113.9'],
    ] as const) {
      const app = Fastify({ trustProxy: parseTrustProxy(setting) });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      const res = await app.inject({
        method: 'GET',
        url: '/ip',
        headers: { 'x-forwarded-for': '203.0.113.9' },
        remoteAddress: '127.0.0.1',
      });
      expect(res.json().ip).toBe(expected);
      await app.close();
    }
  });

  // A client-written address, then the real client (added by the outer
  // proxy), then the inner proxy; the request arrives from the inner proxy.
  const chain = { 'x-forwarded-for': '203.0.113.66, 198.51.100.7, 10.0.0.2' };

  it('with proxy CIDRs, the client is the right-most forwarded address that is not a trusted proxy', async () => {
    const { default: Fastify } = await import('fastify');
    const { parseTrustProxy } = await import('./env.js');
    for (const setting of ['10.0.0.0/8', '10.0.0.0/8, 127.0.0.1', '10.0.0.1,10.0.0.2']) {
      const app = Fastify({ trustProxy: parseTrustProxy(setting) });
      app.get('/ip', async (req) => ({ ip: req.ip }));
      const res = await app.inject({ method: 'GET', url: '/ip', headers: chain, remoteAddress: '10.0.0.1' });
      expect(res.json().ip, setting).toBe('198.51.100.7');
      await app.close();
    }
    // Sent straight from an untrusted address, forwarded headers are ignored.
    const app = Fastify({ trustProxy: parseTrustProxy('10.0.0.0/8') });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const direct = await app.inject({ method: 'GET', url: '/ip', headers: chain, remoteAddress: '192.0.2.50' });
    expect(direct.json().ip).toBe('192.0.2.50');
    await app.close();
  });

  it('with TRUST_PROXY=true, the left-most address is used, and the server warns at start-up', async () => {
    const { default: Fastify } = await import('fastify');
    const { parseTrustProxy, trustProxyWarning } = await import('./env.js');
    const app = Fastify({ trustProxy: parseTrustProxy('true') });
    app.get('/ip', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ method: 'GET', url: '/ip', headers: chain, remoteAddress: '10.0.0.1' });
    expect(res.json().ip).toBe('203.0.113.66');
    await app.close();

    expect(trustProxyWarning(true)).toMatch(/CIDR/);
    expect(trustProxyWarning(false)).toBeNull();
    expect(trustProxyWarning('10.0.0.0/8')).toBeNull();
  });
});
