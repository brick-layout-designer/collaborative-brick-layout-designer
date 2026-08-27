// Smoke tests for api.ts client helpers.
// We don't hit a real server — we stub globalThis.fetch to assert that the
// client builds the right URL, method, headers, and body, and that it
// surfaces HTTP errors correctly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, spriteUrlFor, type PartWire } from '../api';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response('{}', { status });
}

type FetchSpy = ReturnType<typeof vi.fn>;

function stubFetch(resp: Response | (() => Response)): FetchSpy {
  const spy = vi.fn(() => (typeof resp === 'function' ? resp() : resp));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

// --------------------------------------------------------------------------
// spriteUrlFor
// --------------------------------------------------------------------------

describe('spriteUrlFor', () => {
  const base: PartWire = {
    key: 'test.0', partNumber: 'TEST', colorCode: '0', kind: 'leaf',
    description: '', sortingKey: '', spritePath: 'parts/test.gif',
    pxPerStud: 32, category: 'test', connections: [], subparts: [],
    hullPts: [], source: 'bundled', customPartId: null,
  };

  it('returns /parts/<spritePath> for bundled parts', () => {
    expect(spriteUrlFor(base)).toBe('/parts/parts/test.gif');
  });

  it('returns /api/custom-parts/:id/sprite for custom parts', () => {
    const custom: PartWire = { ...base, source: 'custom', customPartId: 'abc123', spritePath: '' };
    expect(spriteUrlFor(custom)).toBe('/api/custom-parts/abc123/sprite');
  });

  it('returns empty string when bundled part has no spritePath', () => {
    expect(spriteUrlFor({ ...base, spritePath: '' })).toBe('');
  });
});

// --------------------------------------------------------------------------
// api.me
// --------------------------------------------------------------------------

describe('api.me', () => {
  it('sends GET /api/auth/me with credentials', async () => {
    const spy = stubFetch(okResponse({ user: null }));
    await api.me();
    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/me');
    expect(init?.credentials).toBe('include');
  });

  it('throws a friendly message when the server returns an error status', async () => {
    stubFetch(errorResponse(401));
    await expect(api.me()).rejects.toThrow('You need to sign in to do that.');
  });
});

// --------------------------------------------------------------------------
// api.layouts.*
// --------------------------------------------------------------------------

describe('api.layouts.list', () => {
  it('sends GET /api/layouts', async () => {
    const spy = stubFetch(okResponse({ layouts: [] }));
    await api.layouts.list();
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/layouts');
  });
});

describe('api.layouts.create', () => {
  it('sends POST /api/layouts with JSON body', async () => {
    const spy = stubFetch(okResponse({ id: 'x', title: 'T' }));
    await api.layouts.create({ title: 'Test Layout' });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/layouts');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toMatchObject({ title: 'Test Layout' });
  });
});

describe('api.layouts.rename', () => {
  it('sends PATCH /api/layouts/:id with title', async () => {
    const spy = stubFetch(okResponse({ ok: true }));
    await api.layouts.rename('layout-1', 'New Title');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/layouts/layout-1');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toMatchObject({ title: 'New Title' });
  });
});

describe('api.layouts.remove', () => {
  it('sends DELETE /api/layouts/:id', async () => {
    const spy = stubFetch(new Response(null, { status: 200 }));
    // del() returns void — but 200 with no JSON body will throw on res.json()
    // unless the server returns JSON. Stub a valid response.
    vi.unstubAllGlobals();
    const spy2 = vi.fn(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', spy2);
    await api.layouts.remove('layout-1');
    const [url, init] = spy2.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/layouts/layout-1');
    expect(init?.method).toBe('DELETE');
    void spy;
  });
});

describe('api.layouts — url helpers', () => {
  it('exportBbmUrl returns the correct path', () => {
    expect(api.layouts.exportBbmUrl('abc')).toBe('/api/layouts/abc/export.bbm');
  });

  it('exportZipUrl returns the correct path', () => {
    expect(api.layouts.exportZipUrl('abc')).toBe('/api/layouts/abc/export.zip');
  });
});

describe('api.layouts.enablePublicShare', () => {
  it('sends POST /api/layouts/:id/public-share', async () => {
    const spy = stubFetch(okResponse({ token: 'tok123' }));
    await api.layouts.enablePublicShare('layout-2');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/layouts/layout-2/public-share');
    expect(init?.method).toBe('POST');
  });
});

describe('api.layouts.disablePublicShare', () => {
  it('sends DELETE /api/layouts/:id/public-share', async () => {
    vi.unstubAllGlobals();
    const spy = vi.fn(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', spy);
    await api.layouts.disablePublicShare('layout-3');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/layouts/layout-3/public-share');
    expect(init?.method).toBe('DELETE');
  });
});

// --------------------------------------------------------------------------
// api.publicLayouts
// --------------------------------------------------------------------------

describe('api.publicLayouts.get', () => {
  it('sends GET /api/public-layouts/:token', async () => {
    const spy = stubFetch(okResponse({ layout: { id: 'x', title: 'T', updatedAt: 0, docVersion: 0, hasSidecar: false } }));
    await api.publicLayouts.get('mytoken');
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/public-layouts/mytoken');
  });
});

// --------------------------------------------------------------------------
// api.passwordLogin / register
// --------------------------------------------------------------------------

describe('api.passwordLogin', () => {
  it('sends POST with email and password', async () => {
    const spy = stubFetch(okResponse({ ok: true }));
    await api.passwordLogin('u@e.com', 's3cr3t');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/password/login');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as { email: string; password: string };
    expect(body.email).toBe('u@e.com');
    expect(body.password).toBe('s3cr3t');
  });
});

describe('api.passwordRegister', () => {
  it('sends POST with email, password, and optional displayName', async () => {
    const spy = stubFetch(okResponse({ ok: true }));
    await api.passwordRegister('u@e.com', 'pass', 'Alice');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/auth/password/register');
    const body = JSON.parse(init?.body as string) as { displayName: string };
    expect(body.displayName).toBe('Alice');
  });
});

// --------------------------------------------------------------------------
// api.orgs
// --------------------------------------------------------------------------

describe('api.orgs.create', () => {
  it('sends POST /api/orgs with name when slug is omitted', async () => {
    const spy = stubFetch(okResponse({ id: 'o', name: 'Acme', slug: 'acme' }));
    await api.orgs.create('Acme');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/orgs');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as { name: string; slug?: string };
    expect(body.name).toBe('Acme');
    expect(body.slug).toBeUndefined();
  });

  it('includes slug when provided', async () => {
    const spy = stubFetch(okResponse({ id: 'o', name: 'Acme', slug: 'acme' }));
    await api.orgs.create('Acme', 'acme');
    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1]?.body as string) as { slug: string };
    expect(body.slug).toBe('acme');
  });
});

// --------------------------------------------------------------------------
// Error propagation
// --------------------------------------------------------------------------

describe('error propagation', () => {
  it('api.me() throws a friendly message when the server errors, never the raw path/status', async () => {
    stubFetch(errorResponse(500));
    let err: Error | null = null;
    try { await api.me(); } catch (e) { err = e as Error; }
    expect(err).not.toBeNull();
    expect(err!.message).not.toContain('/api/auth/me');
    expect(err!.message).not.toContain('500');
    expect(err!.message).toBe('Something went wrong on our end. Please try again.');
  });

  it('api.layouts.list() throws a friendly message for 403', async () => {
    stubFetch(errorResponse(403));
    await expect(api.layouts.list()).rejects.toThrow("You don't have permission to do that.");
  });

  it('surfaces the server-provided error code as a friendly message when present', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'invalid_credentials' }), { status: 401 }));
    await expect(api.passwordLogin('a@b.com', 'wrongpass')).rejects.toThrow('Incorrect email or password.');
  });
});
