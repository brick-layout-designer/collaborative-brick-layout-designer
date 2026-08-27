// E2E: Brick selection, dragging, and parts-panel sprite rendering.
//
// Regression coverage for two bugs found in manual testing:
//   1. Every shape inside a brick's Konva Group (sprite image, fallback
//      rect, selection halo, hull outline, connection dots) was
//      `listening={false}`. Konva hit-tests against a per-Layer offscreen
//      hit-canvas that non-listening shapes never paint onto, and a Group
//      has no hit area beyond the union of its listening children's — so
//      a brick's `draggable` Group had NO hit area at all. Clicking
//      directly on a brick's own pixels never registered a hit, meaning
//      bricks could never actually be selected or dragged via the canvas.
//      Fixed by making the sprite image (and its fallback rect) listen.
//   2. The Vite dev proxy forwarded /api and /ws to the backend but not
//      /parts — every sprite request got Vite's SPA index.html fallback
//      (text/html) instead of the actual image, so every part thumbnail
//      and every placed brick's sprite silently failed to render.

import { test, expect } from '@playwright/test';
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
const EMAIL = `brick-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

async function loginAndImportFordyce(page: import('@playwright/test').Page): Promise<string> {
  await page.request.post('/api/auth/password/register', {
    data: { email: EMAIL, password: PASS, displayName: 'Brick Tester' },
  });
  await page.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });
  const res = await page.request.post('/api/layouts', {
    data: { title: 'Brick Interaction Test', bbm: FORDYCE_BBM },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  return id;
}

/**
 * Scan a grid of points around the stage centre for one that selects a
 * brick (the status bar's "selected: N" text appears). Real layouts vary
 * in exactly where bricks sit relative to the viewport's default pan/zoom,
 * so a single fixed coordinate is too brittle — this mirrors how a user
 * would hunt-and-click until something highlights.
 */
async function findSelectableBrick(
  page: import('@playwright/test').Page,
): Promise<{ x: number; y: number }> {
  const stage = page.locator('.konvajs-content').first();
  const box = await stage.boundingBox();
  if (!box) throw new Error('no stage bounding box');
  const footer = page.locator('footer');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (let dx = -300; dx <= 300; dx += 25) {
    for (let dy = -200; dy <= 200; dy += 20) {
      const x = cx + dx;
      const y = cy + dy;
      await page.mouse.click(x, y);
      const text = await footer.innerText();
      if (text.includes('selected: ')) return { x, y };
    }
  }
  throw new Error('no selectable brick found in scanned area');
}

test.describe('brick interaction — select and drag', () => {
  test('clicking a brick selects it', async ({ page }) => {
    const id = await loginAndImportFordyce(page);
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500); // sprite cache + WS sync settle

    const point = await findSelectableBrick(page);
    void point;
    await expect(page.locator('footer')).toContainText('selected: ');
  });

  test('dragging a selected brick moves it (persists to the doc)', async ({ page }) => {
    const id = await loginAndImportFordyce(page);

    // Capture the pristine, freshly-imported state via the DB-backed
    // export BEFORE opening any WS session — at this point docSnapshot
    // is guaranteed accurate (nothing has edited it yet), so this is a
    // reliable "before" baseline despite that column only refreshing on
    // flush in general.
    const before = await page.request.get(`/api/layouts/${id}/export.bbm`).then((r) => r.text());

    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    const { x, y } = await findSelectableBrick(page);
    await expect(page.locator('footer')).toContainText('selected: ');

    // A real click-and-drag gesture: press on the already-selected brick,
    // then move in several small, distinct increments (not one big jump)
    // so Konva's own dragstart-distance threshold reliably fires and its
    // dragmove handler sees genuine intermediate positions. The distance
    // is large relative to the canvas (well beyond any single connection
    // snap's pull range) so a real move can't coincidentally land back on
    // the start position.
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + i * 30, y + i * 25);
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(500);

    // Selection must survive the drag — the earlier bug (no hit area on
    // the brick's shapes) manifested as the drag never starting at all,
    // which looked like the click falling through to empty canvas and
    // clearing selection.
    await expect(page.locator('footer')).not.toContainText('no selection');
    // The toolbar's Undo button reflects whether a mutation actually
    // committed to the doc.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();

    // Verify the move round-trips through real persistence, not just the
    // live in-memory Yjs doc. `/snapshot` and `/export.bbm` both read the
    // `layouts.docSnapshot` DB column, which is only refreshed by
    // `flushSnapshot()` — triggered when the last WS client disconnects,
    // or once enough pending updates accumulate — NOT on every edit. A
    // single drag doesn't cross that threshold, so we close this page
    // (the only client on this layout) to force the flush, matching how
    // the app is actually designed to persist.
    await page.close();
    const ctx2 = await page.context().browser()!.newContext();
    const verifyPage = await ctx2.newPage();
    await verifyPage.request.post('/api/auth/password/login', { data: { email: EMAIL, password: PASS } });
    const after = await verifyPage.request.get(`/api/layouts/${id}/export.bbm`).then((r) => r.text());
    expect(after).not.toBe(before);
    await ctx2.close();
  });
});

test.describe('brick interaction — parts panel sprites', () => {
  test('part thumbnails load actual images, not a broken proxy fallback', async ({ page }) => {
    const id = await loginAndImportFordyce(page);
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    const firstImg = page.locator('aside img').first();
    await expect(firstImg).toBeVisible({ timeout: 10000 });
    // A broken/404'd (or wrong content-type) image still renders an <img>
    // tag but reports naturalWidth 0 — this is what the missing /parts
    // proxy entry produced (Vite's index.html served back as the "image").
    const naturalWidth = await firstImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
    expect(naturalWidth).toBeGreaterThan(0);
  });

  test('a placed brick on the canvas renders its sprite', async ({ page }) => {
    const id = await loginAndImportFordyce(page);
    await page.goto(`/editor/${id}`);
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    // The Konva stage draws to <canvas>, so we can't inspect individual
    // sprite <img> elements there — but we can confirm the canvas isn't
    // blank by sampling pixel content, which is trivially true once real
    // artwork (not just background/grid) is drawn.
    const hasNonBackgroundPixels = await canvas.evaluate((el: HTMLCanvasElement) => {
      const ctx = el.getContext('2d');
      if (!ctx) return false;
      const { width, height } = el;
      const data = ctx.getImageData(0, 0, width, height).data;
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i += 4 * 97) {
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        if (seen.size > 3) return true;
      }
      return seen.size > 3;
    });
    expect(hasNonBackgroundPixels).toBe(true);
  });
});
