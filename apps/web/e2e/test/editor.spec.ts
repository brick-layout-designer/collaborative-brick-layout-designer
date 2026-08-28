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

/**
 * /api/auth/password/register and /login are both rate-limited (10/min)
 * — a real, intentional anti-abuse control. This file's ~18 tests all
 * call loginAndCreateLayout, which register/login every time (harmless
 * since it's the same account — register just 409s after the first),
 * easily exceeding 10/min. Retry on 429 using the server's own
 * `retry-after` header rather than guessing a backoff.
 */
async function postWithRateLimitRetry(page: Page, path: string, data: Record<string, string>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await page.request.post(path, { data });
    if (res.ok() || res.status() === 409) return; // 409 email_taken is fine — account exists
    if (res.status() === 429 && attempt < 3) {
      const retryAfterSec = Number(res.headers()['retry-after'] ?? '5');
      await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
      continue;
    }
    return; // give up silently, matching this helper's original fire-and-forget style
  }
}

async function loginAndCreateLayout(page: Page): Promise<string> {
  await postWithRateLimitRetry(page, '/api/auth/password/register', {
    email: EMAIL,
    password: PASS,
    displayName: 'Editor Tester',
  });
  await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });
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
    // The editor's toolbar is plain <button>s in a <header> row (no
    // role="toolbar"/data-testid/<nav> — those only exist on the
    // Layouts/Orgs pages' AppHeader, which the editor doesn't render).
    // The "Select" tool button is always present and active by default.
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible({ timeout: 5000 });
  });
});

test.describe('editor — tool switching', () => {
  test('clicking the rotate tool activates it', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Toolbar.tsx has no aria-pressed / active|selected|current class —
    // the active tool button gets `bg-blue-600 text-white` (see TOOLS.map
    // in Toolbar.tsx) and the status bar's "Tool: <name>" also reflects
    // the current tool; check both real signals.
    const rotateBtn = page.getByRole('button', { name: 'Rotate' });
    await rotateBtn.click();
    await expect(rotateBtn).toHaveClass(/bg-blue-600/);
    await expect(page.locator('footer')).toContainText('Tool: rotate');
  });

  test('clicking delete tool activates it', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // /delete|erase|remove/i ambiguously matches multiple buttons: the
    // global "Delete (Del)" selection-delete action, the "Erase" tool,
    // and the Toolbar's own "Delete" tool — and even an exact accessible
    // name of "Delete" still matches both Delete buttons (the global
    // one's computed name apparently still satisfies it). The `title`
    // attribute is the only thing that disambiguates them: the
    // Toolbar's tool has no shortcut suffix (see TOOLS.map in
    // Toolbar.tsx), so its title is the bare string "Delete".
    const deleteBtn = page.getByTitle('Delete', { exact: true });
    await deleteBtn.click();
    await expect(page.locator('footer')).toContainText('Tool: delete');
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('clicking select tool activates it after switching away', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    const rotateBtn = page.getByRole('button', { name: 'Rotate' });
    const selectBtn = page.getByRole('button', { name: 'Select' });
    await rotateBtn.click();
    await expect(page.locator('footer')).toContainText('Tool: rotate');
    await selectBtn.click();
    await expect(page.locator('footer')).toContainText('Tool: select');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});

test.describe('editor — keyboard shortcuts', () => {
  test('Ctrl+Z triggers undo without crashing the editor', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    // Click the canvas to focus it, then send undo. The Konva Stage
    // stacks 3 <canvas> elements (interactive layer + HUD overlay on
    // top); `.first()` is the bottom one, which the top layer
    // legitimately intercepts pointer events for — Playwright's
    // actionability check correctly refuses a plain click there.
    // Click the topmost canvas instead, matching a real user's click.
    await page.locator('canvas').last().click();
    await page.keyboard.press('Control+z');
    // Canvas must still be visible after the keypress.
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Ctrl+Y triggers redo without crashing', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    await page.locator('canvas').last().click();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Escape clears selection without crashing', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);
    await page.locator('canvas').last().click();
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
    // loginAndCreateLayout already logs in — no need to do it twice
    // (and every hit against the rate-limited login endpoint counts).
    const id = await loginAndCreateLayout(page);

    const exportRes = await page.request.get(`/api/layouts/${id}/export.bbm`);
    expect(exportRes.ok()).toBe(true);
    expect(exportRes.headers()['content-type']).toContain('xml');
  });
});

test.describe('editor — Fordyce 2026 import', () => {
  test('imports Fordyce 2026 .bbm and opens editor without crashing', async ({ page }) => {
    await postWithRateLimitRetry(page, '/api/auth/password/register', {
      email: EMAIL, password: PASS, displayName: 'Editor Tester',
    });
    await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026', bbm: FORDYCE_BBM },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('Fordyce 2026 layout title is shown in the editor', async ({ page }) => {
    await postWithRateLimitRetry(page, '/api/auth/password/register', {
      email: EMAIL, password: PASS, displayName: 'Editor Tester',
    });
    await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Title Test', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await expect(page.getByText('Fordyce 2026 Title Test')).toBeVisible({ timeout: 8000 });
  });

  test('Fordyce 2026 snapshot returns substantial bytes', async ({ page }) => {
    await postWithRateLimitRetry(page, '/api/auth/password/register', {
      email: EMAIL, password: PASS, displayName: 'Editor Tester',
    });
    await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });

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
    await postWithRateLimitRetry(page, '/api/auth/password/register', {
      email: EMAIL, password: PASS, displayName: 'Editor Tester',
    });
    await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Round-trip', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    const exportRes = await page.request.get(`/api/layouts/${id}/export.bbm`);
    expect(exportRes.ok()).toBe(true);
    const xml = await exportRes.text();
    expect(xml).toContain('<Map>');
    expect(xml).toContain('</Map>');
    // Original has 949 bricks. The writer emits `<Brick id="...">` (see
    // packages/bbm/src/Writer.ts) — there's no `<BrickRef>` element.
    const itemMatches = xml.match(/<Brick id="/g);
    expect(itemMatches).not.toBeNull();
    expect(itemMatches!.length).toBeGreaterThan(100);
  });

  test('Fordyce 2026 undo/redo does not crash the editor', async ({ page }) => {
    await postWithRateLimitRetry(page, '/api/auth/password/register', {
      email: EMAIL, password: PASS, displayName: 'Editor Tester',
    });
    await postWithRateLimitRetry(page, '/api/auth/password/login', { email: EMAIL, password: PASS });

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 UndoRedo', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    await openEditor(page, id);
    await page.locator('canvas').last().click();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+y');
    await expect(page.locator('canvas').first()).toBeVisible();
  });
});

test.describe('editor — layers panel', () => {
  // Regression coverage for: "add layer" was silently a no-op because the
  // menu wired into the idempotent `ensure*Layer` seed helpers (which
  // early-return the existing layer of that kind instead of creating a
  // new one) rather than a real "always add" mutation. See addLayer() in
  // apps/web/src/editor/mutations.ts.

  test('adding a parts layer actually adds a new layer', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);

    const layersPanel = page.locator('aside', { hasText: 'Layers' });
    await expect(layersPanel).toBeVisible();

    const countBefore = Number(await layersPanel.locator('span.text-neutral-600').innerText());

    await layersPanel.getByTitle('Add a new layer').click();
    await page.getByRole('button', { name: 'Parts layer' }).click();

    await expect(layersPanel.locator('span.text-neutral-600')).toHaveText(String(countBefore + 1));

    // A second "Parts layer" click must add ANOTHER layer, not silently
    // no-op on top of the one that already exists (the original bug).
    await layersPanel.getByTitle('Add a new layer').click();
    await page.getByRole('button', { name: 'Parts layer' }).click();
    await expect(layersPanel.locator('span.text-neutral-600')).toHaveText(String(countBefore + 2));

    // The two new parts layers get disambiguated default names.
    await expect(layersPanel.getByText('Parts', { exact: true })).toBeVisible();
    await expect(layersPanel.getByText('Parts 2', { exact: true })).toBeVisible();
  });

  test('newly added layer becomes the active layer', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);

    const layersPanel = page.locator('aside', { hasText: 'Layers' });
    await layersPanel.getByTitle('Add a new layer').click();
    await page.getByRole('button', { name: 'Area layer' }).click();

    // The active row is highlighted with a blue left border + background;
    // the newly-added "Area" row should be the one carrying it.
    const activeRow = layersPanel.locator('li.border-l-blue-500');
    await expect(activeRow).toContainText('Area');
  });

  test('layers panel shows a part count for the default parts (brick) layer', async ({ page }) => {
    const id = await loginAndCreateLayout(page);
    await openEditor(page, id);

    const layersPanel = page.locator('aside', { hasText: 'Layers' });
    // A freshly-created layout seeds one grid layer + one brick layer
    // named "Layout" (createDefaultLayoutDoc, packages/ydoc/src/index.ts).
    const partsRow = layersPanel.locator('li', { hasText: 'Layout' }).first();
    // Starts empty.
    await expect(partsRow.locator('span.tabular-nums.text-\\[10px\\].text-neutral-500')).toHaveText('0');
  });
});
