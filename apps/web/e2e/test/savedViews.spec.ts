// Saved views and "Share picture": two views saved in the Views panel
// survive a reload and reach the server's sidecar; "Export all views"
// downloads a zip with one PNG per view at the view's size; and on a
// phone "Share picture" hands the PNG to navigator.share, or downloads it
// where the browser can't share files.
//
// SHOTS_DIR=<dir> also saves screenshots of the panel and the share sheet.

import { test, expect, devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { signIn } from '../helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const TIGHT_CORNER = readFileSync(join(FIXTURES, 'tight-corner.bbm'), 'utf-8');
const SHOTS = process.env.SHOTS_DIR;
const ts = Date.now();
let seq = 0;

/** A zip's entries (stored or deflated), by name, in order. */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const out = new Map<string, Buffer>();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

/** A PNG's size, from its IHDR. */
function pngSize(b: Buffer): { width: number; height: number } {
  expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

async function newLayout(page: Page, who: string, title: string, sidecar?: unknown): Promise<string> {
  await signIn(page, `views-${who}-${ts}-${seq++}@example.com`, 'Views Tester');
  const res = await page.request.post('/api/layouts', {
    data: { title, bbm: TIGHT_CORNER, ...(sidecar ? { sidecar: JSON.stringify(sidecar) } : {}) },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15000 });
  await page.waitForTimeout(500); // first render and fit
}

const views = (page: Page) => page.getByRole('region', { name: 'Views' });

test.describe('saved views', () => {
  test('two views persist, reach the server, and Export all views zips one PNG each', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const id = await newLayout(page, 'desktop', 'Views Test');
    await openEditor(page, id);

    // The Build tab shows the Views panel.
    await page.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Build' }).click();
    const panel = views(page);
    await expect(panel.getByText(/No saved views yet/)).toBeVisible();

    await panel.getByRole('button', { name: '+ Add view' }).click();
    await panel.getByLabel('Name the view').fill('Whole');
    await panel.getByRole('button', { name: 'Add view', exact: true }).click();
    await expect(page.getByTestId('active-view')).toContainText('Showing Whole');

    await panel.getByRole('button', { name: '+ Add view' }).click();
    await panel.getByLabel('Name the view').fill('Corner');
    await panel.getByRole('button', { name: 'Add view', exact: true }).click();
    await panel.getByRole('button', { name: 'Change Corner' }).click();
    await panel.getByRole('button', { name: 'Use this area' }).click();
    await expect(panel.getByText('One area · all sheets')).toBeVisible();
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/views-panel-desktop-light.png` });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/views-panel-desktop-dark.png` });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    // Reload: both are still there (the panel stays open too).
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await expect(views(page).getByRole('button', { name: /^Whole/ })).toBeVisible({ timeout: 15000 });
    await expect(views(page).getByRole('button', { name: /^Corner/ })).toBeVisible();

    // The server's sidecar has them, in order, as the file format says.
    const sidecar = (await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as {
      views: { name: string; fit: boolean; rect: { x: number; y: number; w: number; h: number } | null; sheets: unknown }[];
    };
    expect(sidecar.views.map((v) => [v.name, v.fit, v.sheets])).toEqual([
      ['Whole', true, null],
      ['Corner', false, null],
    ]);
    const rect = sidecar.views[1]!.rect!;
    expect(rect.w).toBeGreaterThan(0);

    // Export all views: one click, a zip of two PNGs named after the layout and the view.
    const dl = page.waitForEvent('download');
    await views(page).getByRole('button', { name: 'Export all views' }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('Views Test - views.zip');
    const entries = unzip(readFileSync(await download.path()));
    expect([...entries.keys()]).toEqual(['Views Test - Whole.png', 'Views Test - Corner.png']);
    // Medium (2x): 16 px per stud.
    expect(pngSize(entries.get('Views Test - Corner.png')!)).toEqual({ width: Math.round(rect.w * 16), height: Math.round(rect.h * 16) });
    const whole = pngSize(entries.get('Views Test - Whole.png')!);
    expect(whole.width).toBeGreaterThan(100);
    expect(whole.height).toBeGreaterThan(100);
  });

  test('Share picture on a computer downloads the picture and offers more options', async ({ page }) => {
    const id = await newLayout(page, 'computer-share', 'Share Test');
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Share picture' }).click();
    const sheet = page.getByTestId('share-picture');
    await expect(sheet.getByRole('img', { name: 'Picture of Whole layout' })).toBeVisible({ timeout: 15000 });
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/views-share-desktop-light.png` });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/views-share-desktop-dark.png` });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    const dl = page.waitForEvent('download');
    await sheet.getByRole('button', { name: 'Download picture' }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('Share Test - Whole layout.png');
    expect(pngSize(readFileSync(await download.path())).width).toBeGreaterThan(100);
    await sheet.getByRole('button', { name: 'More options…' }).click();
    await expect(page.getByTestId('share-picture')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Export/ }).first()).toBeVisible();
  });
});

const { defaultBrowserType: _d, ...iPhone14 } = devices['iPhone 14'];

test.describe('share picture on a phone', () => {
  test.use(iPhone14);

  const PHONE_VIEWS = {
    schemaVersion: 1,
    bbmHashSha256: '',
    views: [{ id: 'v1', name: 'Station', fit: true, rect: null, sheets: null, grid: false, labels: true }],
  };

  test('hands the PNG to navigator.share, and the views are in the menu', async ({ page }) => {
    await page.addInitScript(() => {
      const shared: { name: string; type: string; size: number }[] = [];
      (window as unknown as { __shared: typeof shared }).__shared = shared;
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: { files?: File[] }) => !!d.files?.length });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: { files: File[] }) => {
          for (const f of d.files) shared.push({ name: f.name, type: f.type, size: f.size });
        },
      });
    });
    const id = await newLayout(page, 'phone-share', 'Phone Test', PHONE_VIEWS);
    await openEditor(page, id);

    // The saved views sit in the layout's menu: pick one to see it.
    await page.getByTestId('editor-header').locator('h1').tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitemradio', { name: 'Whole layout' })).toBeVisible();
    await menu.getByRole('menuitemradio', { name: 'Station' }).tap();
    await expect(page.getByTestId('active-view')).toContainText('Showing Station');

    await page.getByTestId('editor-header').getByRole('button', { name: 'Share picture' }).tap();
    const sheet = page.getByTestId('share-picture');
    await sheet.getByText('Station', { exact: true }).tap();
    await expect(sheet.getByRole('img', { name: 'Picture of Station' })).toBeVisible({ timeout: 15000 });
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/views-share-phone-light.png` });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/views-share-phone-dark.png` });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    // Fits the phone, no sideways scroll.
    const box = (await sheet.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
    await sheet.getByRole('button', { name: 'Share picture' }).tap();
    await expect(sheet.getByRole('status')).toHaveText('Shared.');
    const shared = await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
    expect(shared).toEqual([{ name: 'Phone Test - Station.png', type: 'image/png', size: expect.any(Number) }]);
    expect((shared[0] as { size: number }).size).toBeGreaterThan(1000);
  });

  test('downloads the picture where the browser can’t share files', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    });
    const id = await newLayout(page, 'phone-download', 'Phone Test', PHONE_VIEWS);
    await openEditor(page, id);
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/views-header-phone-light.png` });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/views-header-phone-dark.png` });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await page.getByTestId('editor-header').locator('h1').tap();
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/views-menu-phone-light.png` });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/views-menu-phone-dark.png` });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await page.getByRole('menu').getByRole('menuitem', { name: 'Share picture…' }).tap();
    const sheet = page.getByTestId('share-picture');
    await expect(sheet.getByRole('img', { name: 'Picture of Whole layout' })).toBeVisible({ timeout: 15000 });
    const dl = page.waitForEvent('download');
    await sheet.getByRole('button', { name: 'Download picture' }).tap();
    expect((await dl).suggestedFilename()).toBe('Phone Test - Whole layout.png');
  });
});
