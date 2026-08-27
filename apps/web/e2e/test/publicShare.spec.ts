// E2E: Public share — enable sharing, anonymous viewer, token-based access.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = Date.now();
const EMAIL = `share-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

const FORDYCE_BBM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm',
  ),
  'utf-8',
);

async function registerAndLogin(page: Page): Promise<void> {
  await page.request.post('/api/auth/password/register', {
    data: { email: EMAIL, password: PASS, displayName: 'Share Tester' },
  });
  await page.request.post('/api/auth/password/login', {
    data: { email: EMAIL, password: PASS },
  });
}

async function createLayout(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/layouts', { data: { title } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function createLayoutFromBbm(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/layouts', {
    data: { title, bbm: FORDYCE_BBM },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  return id;
}

async function enableSharing(page: Page, id: string): Promise<string> {
  const res = await page.request.post(`/api/layouts/${id}/public-share`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { token: string };
  return body.token;
}

test.describe('public share — setup', () => {
  test('enabling sharing returns a share token', async ({ page }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Share Setup Test');
    const res = await page.request.post(`/api/layouts/${id}/public-share`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { token: string };
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(8);
  });

  test('enabling sharing twice returns the same token (idempotent)', async ({ page }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Idempotent Share');
    const first = await enableSharing(page, id);
    const second = await enableSharing(page, id);
    expect(first).toBe(second);
  });

  test('disabling sharing makes the token invalid', async ({ page }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Disable Share Test');
    const token = await enableSharing(page, id);

    // Confirm token works before disabling.
    const before = await page.request.get(`/api/public-layouts/${token}`);
    expect(before.ok()).toBe(true);

    // Disable.
    const del = await page.request.delete(`/api/layouts/${id}/public-share`);
    expect(del.ok()).toBe(true);

    // Token should now return 404.
    const after = await page.request.get(`/api/public-layouts/${token}`);
    expect(after.status()).toBe(404);
  });
});

test.describe('public share — anonymous API access', () => {
  test('anonymous GET /api/public-layouts/:token returns layout metadata', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Public Metadata Layout');
    const token = await enableSharing(page, id);

    // Open an anonymous context (no cookies).
    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    const res = await anonPage.request.get(`/api/public-layouts/${token}`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe('Public Metadata Layout');
    await anonCtx.close();
  });

  test('anonymous GET /api/public-layouts/:token/snapshot returns bytes', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Public Snapshot Layout');
    const token = await enableSharing(page, id);

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    const snap = await anonPage.request.get(
      `/api/public-layouts/${token}/snapshot`,
    );
    expect(snap.ok()).toBe(true);
    expect(snap.headers()['content-type']).toBe('application/octet-stream');
    const buf = await snap.body();
    expect(buf.byteLength).toBeGreaterThan(0);
    await anonCtx.close();
  });

  test('unknown token returns 404', async ({ page }) => {
    await registerAndLogin(page);
    const res = await page.request.get(
      '/api/public-layouts/definitely-not-a-real-token',
    );
    expect(res.status()).toBe(404);
  });
});

test.describe('public share — Fordyce 2026 layout', () => {
  test('import Fordyce 2026 .bbm and enable sharing', async ({ page }) => {
    await registerAndLogin(page);
    const id = await createLayoutFromBbm(page, 'Fordyce 2026');
    const token = await enableSharing(page, id);
    expect(token.length).toBeGreaterThan(8);

    // Verify the metadata is correct.
    const meta = await page.request.get(`/api/public-layouts/${token}`);
    expect(meta.ok()).toBe(true);
    const body = (await meta.json()) as { title: string };
    expect(body.title).toBe('Fordyce 2026');
  });

  test('Fordyce 2026 public snapshot returns non-trivial bytes', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayoutFromBbm(page, 'Fordyce 2026 Snap');
    const token = await enableSharing(page, id);

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    const snap = await anonPage.request.get(
      `/api/public-layouts/${token}/snapshot`,
    );
    expect(snap.ok()).toBe(true);
    const buf = await snap.body();
    // Fordyce has 949 bricks — the snapshot should be substantial.
    expect(buf.byteLength).toBeGreaterThan(1000);
    await anonCtx.close();
  });

  test('Fordyce 2026 export returns XML with correct content-type', async ({
    page,
  }) => {
    await registerAndLogin(page);
    const id = await createLayoutFromBbm(page, 'Fordyce 2026 Export');
    const exportRes = await page.request.get(`/api/layouts/${id}/export.bbm`);
    expect(exportRes.ok()).toBe(true);
    expect(exportRes.headers()['content-type']).toContain('xml');
    const text = await exportRes.text();
    expect(text).toContain('<Map>');
  });

  test('Fordyce 2026 sidecar export returns JSON content-type', async ({
    page,
  }) => {
    await registerAndLogin(page);
    const id = await createLayoutFromBbm(page, 'Fordyce 2026 Sidecar');
    const res = await page.request.get(`/api/layouts/${id}/export.bbm.cld`);
    // The sidecar may or may not exist; both 200 and 404 are acceptable.
    // If it exists it must be JSON.
    if (res.ok()) {
      expect(res.headers()['content-type']).toContain('json');
    } else {
      expect(res.status()).toBe(404);
    }
  });
});

test.describe('public share — viewer page', () => {
  test('/p/:token renders the layout title for an anonymous user', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Viewer Page Title Test');
    const token = await enableSharing(page, id);

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`/p/${token}`);
    // The viewer should show the layout title somewhere on the page.
    await expect(anonPage.getByText('Viewer Page Title Test')).toBeVisible({
      timeout: 10000,
    });
    await anonCtx.close();
  });

  test('/p/:token shows a canvas for the anonymous viewer', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayout(page, 'Viewer Canvas Test');
    const token = await enableSharing(page, id);

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`/p/${token}`);
    await expect(anonPage.locator('canvas').first()).toBeVisible({
      timeout: 15000,
    });
    const box = await anonPage.locator('canvas').first().boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
    await anonCtx.close();
  });

  test('/p/invalid-token shows a not-found page, not a canvas', async ({
    page,
  }) => {
    await page.goto('/p/this-token-does-not-exist');
    await expect(page.locator('canvas')).not.toBeVisible({ timeout: 3000 });
    await expect(
      page.getByText(/not found|error|unavailable|invalid/i).or(page.locator('h1')),
    ).toBeVisible({ timeout: 5000 });
  });

  test('Fordyce 2026 public viewer renders a canvas', async ({
    page,
    browser,
  }) => {
    await registerAndLogin(page);
    const id = await createLayoutFromBbm(page, 'Fordyce 2026 Viewer');
    const token = await enableSharing(page, id);

    const anonCtx = await browser.newContext();
    const anonPage = await anonCtx.newPage();
    await anonPage.goto(`/p/${token}`);
    await expect(anonPage.locator('canvas').first()).toBeVisible({
      timeout: 20000,
    });
    await anonCtx.close();
  });
});
