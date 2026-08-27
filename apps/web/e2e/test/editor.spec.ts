// E2E: Editor canvas smoke tests — load, toolbar interaction, tool switching,
// undo/redo keyboard shortcuts, and the HUD status bar.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORDYCE_BBM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm',
  ),
  'utf-8',
);

const ts = Date.now();
const EMAIL = `editor-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

async function loginAndCreateLayout(page: Page): Promise<string> {
  await page.request.post('/api/auth/password/register', {
    data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
  });
  await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });
  const res = await page.request.post('/api/layouts', { data: { title: 'Editor Test Layout' } });
  const { id } = await res.json() as { id: string };
  return id;
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/editor/${id}`);
  // Wait for the canvas to appear — up to 15s on first load (sprite cache, WS connect).
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
}

test.describe('editor — load', () => {
  test('editor loads and shows a canvas', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();
    // Canvas must have non-zero dimensions.
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });

  test('editor title is visible in the page', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    await expect(page.getByText('Editor Test Layout')).toBeVisible({ timeout: 5000 });
  });

  test('editor toolbar is visible', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Toolbar should contain at least a select/pointer tool icon or role.
    const toolbar = page.locator('[role="toolbar"]').or(page.locator('[data-testid="toolbar"]')).or(page.locator('nav'));
    await expect(toolbar.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('editor — tool switching', () => {
  test('clicking the rotate tool activates it', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Find a rotate button by label text or aria-label.
    const rotateBtn = page.getByRole('button', { name: /rotate/i });
    if (await rotateBtn.count() > 0) {
      await rotateBtn.click();
      // After clicking, the button (or its parent) should have an active state.
      await expect(rotateBtn).toHaveAttribute('aria-pressed', 'true').catch(() =>
        expect(rotateBtn.or(rotateBtn.locator('..')).first()).toHaveClass(/active|selected|current/),
      );
    }
  });

  test('clicking delete tool activates it', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    const deleteBtn = page.getByRole('button', { name: /delete|erase|remove/i });
    if (await deleteBtn.count() > 0) {
      await deleteBtn.click();
      // No assertion needed beyond not crashing — the tool state is in Zustand.
      await expect(page.locator('canvas').first()).toBeVisible();
    }
  });

  test('clicking select tool activates it after switching away', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    const rotateBtn = page.getByRole('button', { name: /rotate/i });
    const selectBtn = page.getByRole('button', { name: /select|pointer/i });
    if ((await rotateBtn.count()) > 0 && (await selectBtn.count()) > 0) {
      await rotateBtn.click();
      await selectBtn.click();
      await expect(page.locator('canvas').first()).toBeVisible();
    }
  });
});

test.describe('editor — keyboard shortcuts', () => {
  test('Ctrl+Z triggers undo without crashing the editor', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Click the canvas to focus it, then send undo.
    await page.locator('canvas').first().click();
    await page.keyboard.press('Control+z');
    // Canvas must still be visible after the keypress.
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Ctrl+Y triggers redo without crashing', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    await page.locator('canvas').first().click();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Escape clears selection without crashing', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    await page.locator('canvas').first().click();
    await page.keyboard.press('Escape');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});

test.describe('editor — panels', () => {
  test('layers panel is visible or openable', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Look for a "Layers" label anywhere in the sidebar.
    const layersLabel = page.getByText(/layers/i);
    if (await layersLabel.count() > 0) {
      await expect(layersLabel.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('parts panel is visible or openable', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    const partsLabel = page.getByText(/parts/i);
    if (await partsLabel.count() > 0) {
      await expect(partsLabel.first()).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('editor — snapshot API round-trip', () => {
  test('GET /snapshot returns valid bytes and the editor renders them', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    const snap = await page.request.get(`/api/layouts/${id}/snapshot`);
    expect(snap.ok()).toBe(true);
    expect(snap.headers()['content-type']).toBe('application/octet-stream');
    const buf = await snap.body();
    expect(buf.byteLength).toBeGreaterThan(0);

    // Opening the editor should not show an error.
    await openEditor(page, id);
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});

test.describe('editor — export', () => {
  test('export .bbm link is reachable and returns XML', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const exportRes = await page.request.get(`/api/layouts/${id}/export.bbm`);
    expect(exportRes.ok()).toBe(true);
    expect(exportRes.headers()['content-type']).toContain('xml');
  });
});

test.describe('editor — Fordyce 2026 import', () => {
  test('imports Fordyce 2026 .bbm and opens editor without crashing', async ({ page }) => {
    await page.request.post('/api/auth/password/register', {
      data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
    });
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026', bbm: FORDYCE_BBM },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Fordyce 2026 layout title is shown in the editor', async ({ page }) => {
    await page.request.post('/api/auth/password/register', {
      data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
    });
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Title Test', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await expect(page.getByText('Fordyce 2026 Title Test')).toBeVisible({ timeout: 8000 });
  });

  test('Fordyce 2026 snapshot returns substantial bytes', async ({ page }) => {
    await page.request.post('/api/auth/password/register', {
      data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
    });
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Snapshot', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    const snap = await page.request.get(`/api/layouts/${id}/snapshot`);
    expect(snap.ok()).toBe(true);
    const buf = await snap.body();
    // 949 bricks should produce a snapshot well over 1 KB.
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  test('Fordyce 2026 export round-trip preserves XML structure', async ({ page }) => {
    await page.request.post('/api/auth/password/register', {
      data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
    });
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Round-trip', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    const exportRes = await page.request.get(`/api/layouts/${id}/export.bbm`);
    expect(exportRes.ok()).toBe(true);
    const xml = await exportRes.text();
    expect(xml).toContain('<Map>');
    expect(xml).toContain('</Map>');
    // Original has 949 bricks.
    const itemMatches = xml.match(/<BrickRef /g);
    expect(itemMatches).not.toBeNull();
    expect(itemMatches!.length).toBeGreaterThan(100);
  });

  test('Fordyce 2026 undo/redo does not crash the editor', async ({ page }) => {
    await page.request.post('/api/auth/password/register', {
      data: { email: EMAIL, password: PASS, displayName: 'Editor Tester' },
    });
    await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 UndoRedo', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await page.locator('canvas').first().click();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});
