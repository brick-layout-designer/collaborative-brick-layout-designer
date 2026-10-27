// Journey — a set of your own, made on a phone.
//
//   On a Pixel 7, editing: add a part, Duplicate it, pick both → the touch
//   bar's More actions ▸ Save as set… saves them to your custom parts → Add
//   part finds the set and places it, picked as one group → More actions ▸
//   Ungroup splits it, and Group joins it again → the phone's Map sheet has
//   Modules & sets ▸ Save selection as set… too.
//
// Phones have no right-click menu and no Map menu bar, so none of this had a
// way in by touch before.

import { test, expect, devices, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
const PART = 'ts_narrowgauge_straight.8';
const SET = `Phone siding ${ts}`;
const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

// A person's taps are well over the editor's 200 ms undo grouping apart.
const human = (page: Page) => page.waitForTimeout(400);

/** Each part's centre on the page. */
function parts(page: Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; getClientRect: () => { x: number; y: number; width: number; height: number } };
    const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return [];
    const box = st.container().getBoundingClientRect();
    return st
      .find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))
      .map((n) => {
        const r = n.getClientRect();
        return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
      });
  });
}

async function addPart(page: Page, search: string, key?: string): Promise<void> {
  await page.getByTestId('add-part').tap();
  const sheet = page.getByRole('dialog', { name: 'Add a part' });
  await sheet.getByRole('searchbox', { name: 'Search parts' }).fill(search);
  await (key ? sheet.locator(`[data-part-key="${key}"]`) : sheet.getByRole('button', { name: new RegExp(search) })).first().tap();
  await expect(sheet).toHaveCount(0);
}

test('save two parts as a set on a phone, place it, ungroup and group it', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch through Chromium');
  test.setTimeout(180_000);
  await signIn(page, `j-phone-sets-${ts}@example.com`, 'Phone Sets');
  const res = await page.request.post('/api/layouts', { data: { title: 'Phone sets' } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  const bar = page.getByTestId('touch-bar');

  // ── Two parts, both picked. ──
  await addPart(page, 'narrow gauge track straight 4 x 16', PART);
  await human(page);
  await bar.getByRole('button', { name: 'Duplicate' }).tap();
  await expect.poll(async () => (await parts(page)).length).toBe(2);
  await expect(bar).toHaveAttribute('aria-label', '1 picked');
  await bar.getByRole('button', { name: 'Select more' }).tap();
  const [first] = await parts(page);
  await page.touchscreen.tap(first!.x, first!.y);
  await expect(bar).toHaveAttribute('aria-label', '2 picked');

  // ── More actions ▸ Save as set… ──
  await bar.getByRole('button', { name: 'More actions' }).tap();
  const more = page.getByRole('dialog', { name: 'More actions' });
  await expect(more).toContainText('2 parts picked');
  await expect(more.getByRole('button', { name: 'Group' })).toBeVisible();
  await more.getByRole('button', { name: 'Save as set…' }).tap();
  await expect(more).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'Save selection as set' });
  await expect(dialog).toContainText('2 parts selected.');
  // It fits the phone.
  const box = (await dialog.locator(':scope > *').first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
  await dialog.getByLabel('Set name').fill(SET);
  await dialog.getByRole('button', { name: 'Save set' }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Saved the set “${SET}”`)).toBeVisible();
  await bar.getByRole('button', { name: 'Done' }).tap();
  await human(page);

  // ── Add part finds the set and places it, picked as one group. ──
  await addPart(page, SET);
  await expect.poll(async () => (await parts(page)).length).toBe(4);
  await expect(bar).toHaveAttribute('aria-label', '2 picked');

  // ── More actions ▸ Ungroup splits it; Group joins it again. ──
  await human(page);
  await bar.getByRole('button', { name: 'More actions' }).tap();
  await more.getByRole('button', { name: 'Ungroup' }).tap();
  await expect(more).toHaveCount(0);
  await human(page);
  await bar.getByRole('button', { name: 'More actions' }).tap();
  await expect(more.getByRole('button', { name: 'Ungroup' })).toHaveCount(0);
  await more.getByRole('button', { name: 'Group' }).tap();
  await human(page);
  await bar.getByRole('button', { name: 'More actions' }).tap();
  await expect(more.getByRole('button', { name: 'Ungroup' })).toBeVisible();
  await more.getByRole('button', { name: 'Close' }).last().tap();
  await expect(more).toHaveCount(0);

  // ── The phone's Map sheet: Modules & sets ▸ Save selection as set… ──
  await page.getByRole('button', { name: /Phone sets/ }).first().tap();
  await page.getByTestId('phone-map').tap();
  await page.getByRole('menu').last().getByRole('menuitem', { name: 'Modules & sets' }).tap();
  await page.getByRole('menu').last().getByRole('menuitem', { name: 'Save selection as set…' }).tap();
  await expect(dialog).toContainText('2 parts selected.');
  await dialog.getByRole('button', { name: 'Cancel' }).tap();
  await expect(dialog).toHaveCount(0);

  // The server has all four parts.
  await expect.poll(async () => {
    const r = await page.request.get(`/api/layouts/${id}/export.bbm`);
    return ((await r.text()).match(/<Brick id=/g) ?? []).length;
  }, { timeout: 15000 }).toBe(4);
});
