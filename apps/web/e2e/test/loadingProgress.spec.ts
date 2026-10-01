// The loading card: opening a layout says "Opening layout…", then counts the
// part pictures ("Loading part pictures… 132 of 480") with a real progress
// bar, then goes away. Pictures that fail say so plainly, with Retry.
// The part pictures are held back here so the card can be seen.
//
// SHOTS_DIR=<dir> also saves the card, light and dark, on a computer and a phone.

import { test, expect, devices, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FORDYCE_BBM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);
const SHOTS = process.env.SHOTS_DIR;
const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];

const ts = Date.now();
let seq = 0;

/** Holds every part picture (and the parts list) until `release`. */
async function holdPictures(page: Page, opts: { fail?: (url: string) => boolean; holdCatalog?: boolean } = {}) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const failing = { on: true };
  await page.route(
    (url) => url.pathname.startsWith('/parts/'),
    async (route: Route) => {
      await gate;
      if (failing.on && opts.fail?.(route.request().url())) return route.abort();
      return route.continue();
    },
  );
  if (opts.holdCatalog) {
    await page.route('**/api/parts/catalog', async (route) => {
      await gate;
      return route.continue();
    });
  }
  return { release, stopFailing: () => (failing.on = false) };
}

async function newFordyce(page: Page, who: string): Promise<string> {
  await signIn(page, `loading-${who}-${ts}-${seq++}@example.com`, 'Loading Tester');
  const res = await page.request.post('/api/layouts', { data: { title: 'Fordyce 2026', bbm: FORDYCE_BBM } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function expectCounting(page: Page) {
  const card = page.getByTestId('loading-card');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText('Loading part pictures…');
  await expect(page.getByTestId('loading-count')).toHaveText(/^\d[\d,]* of \d[\d,]*$/);
  const bar = card.getByRole('progressbar');
  expect(Number(await bar.getAttribute('aria-valuemax'))).toBeGreaterThan(0);
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0);
}

test('opening a layout shows "Opening layout…", counts the pictures, then goes away', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newFordyce(page, 'open');
  const held = await holdPictures(page, { holdCatalog: true });
  await page.goto(`/editor/${id}`);

  // The parts list is held: the map says the layout is opening.
  await expect(page.getByRole('status').filter({ hasText: 'Opening layout…' })).toBeVisible({ timeout: 15000 });
  held.release();
  // Pictures arrive as they're released; the card counts until the last one.
  await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 30000 });
  await expect(page.getByTestId('loading-failed')).toHaveCount(0);
});

test('the card counts held-back pictures with a real progress bar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newFordyce(page, 'count');
  const held = await holdPictures(page);
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`/editor/${id}`);
    await expectCounting(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-loading-${theme}.png` });
  }
  held.release();
  await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 30000 });
});

test('pictures that fail say so, and Retry loads them', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const id = await newFordyce(page, 'fail');
  const failedUrls = new Set<string>();
  const held = await holdPictures(page, {
    fail: (url) => {
      if (failedUrls.size < 3) failedUrls.add(url);
      return failedUrls.has(url);
    },
  });
  await page.goto(`/editor/${id}`);
  await expectCounting(page);
  held.release();
  const msg = page.getByTestId('loading-failed');
  await expect(msg).toBeVisible({ timeout: 30000 });
  await expect(msg).toContainText("3 pictures couldn't load");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-loading-failed-light.png` });
  held.stopFailing();
  await msg.getByRole('button', { name: 'Retry' }).click();
  await expect(msg).toBeHidden({ timeout: 15000 });
  await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 15000 });
  // The bricks whose pictures failed now draw them.
  await expect.poll(() => drawnPictures(page, [...failedUrls]), { timeout: 15000 }).toBe(3);
});

/** How many of `urls` the map draws as a picture. */
function drawnPictures(page: Page, urls: string[]): Promise<number> {
  return page.evaluate((wanted) => {
    type N = { getClassName: () => string; image?: () => { src?: string } | undefined };
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return 0;
    const srcs = new Set(st.find((n) => n.getClassName() === 'Image').map((n) => n.image?.()?.src ?? ''));
    return wanted.filter((u) => srcs.has(u)).length;
  }, urls);
}

test.describe('on a phone', () => {
  test.use(pixel7);

  test('the card fits the screen and goes away', async ({ page }) => {
    const id = await newFordyce(page, 'phone');
    const held = await holdPictures(page);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`/editor/${id}`);
      await expectCounting(page);
      const box = (await page.getByTestId('loading-card').boundingBox())!;
      const vw = page.viewportSize()!.width;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(vw - 8);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-loading-phone-${theme}.png` });
    }
    held.release();
    await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 30000 });
  });
});
