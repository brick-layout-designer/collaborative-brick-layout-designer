// On a phone, picked parts go to another sheet from the Sheets panel
// (Aaron's choice, 2026-10-10): the layout menu has Sheets… even with
// parts picked, the panel says where they are, and Move here moves them.

import { test, expect, devices } from '@playwright/test';
import { signIn } from '../helpers';

const PART = 'ts_narrowgauge_straight.8';
const { defaultBrowserType: _a, ...pixel7 } = devices['Pixel 7'];

test.use(pixel7);

test('picked parts move to another sheet from the Sheets panel', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch emulation');
  await signIn(page, `phone-sheets-${Date.now()}@example.com`, 'Phone Sheets');
  const res = await page.request.post('/api/layouts', { data: { title: 'Phone sheets' } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();

  // Two part sheets: add a second from the bar's Sheets button (nothing picked yet).
  await page.getByTestId('touch-sheets').tap();
  const panel = page.getByRole('dialog', { name: 'Sheets' });
  for (let i = 0; i < 2; i++) {
    await panel.getByRole('button', { name: 'Add a sheet' }).tap();
    await panel.getByRole('group', { name: 'Add a sheet' }).getByRole('button', { name: /^Parts sheet/ }).tap();
  }
  await panel.getByRole('button', { name: 'Close' }).first().tap();

  // Place a part: it goes on the picked sheet, the new one.
  await page.getByTestId('add-part').tap();
  const sheet = page.getByRole('dialog', { name: 'Add a part' });
  await sheet.getByRole('searchbox', { name: 'Search parts' }).fill('narrow gauge track straight 4 x 16');
  await sheet.locator(`[data-part-key="${PART}"]`).tap();
  await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', '1 picked');

  // With it picked: the layout menu's Sheets… says where it is and offers Move here.
  await page.getByTestId('editor-header').getByRole('button', { name: /Phone sheets/ }).tap();
  await page.getByTestId('phone-sheets').tap();
  const notice = panel.getByTestId('picked-sheet');
  await expect(notice).toContainText('The picked part is on');
  const before = await notice.textContent();
  const moveHere = panel.getByTestId('move-here');
  // Every other parts sheet takes it (the new layout's own "Layout" sheet too); not its own.
  await expect(moveHere).toHaveCount(2);
  await moveHere.first().tap();
  await expect(panel).toBeHidden();

  // It's on the other sheet now.
  await page.getByTestId('editor-header').getByRole('button', { name: /Phone sheets/ }).tap();
  await page.getByTestId('phone-sheets').tap();
  await expect(notice).toBeVisible();
  expect(await notice.textContent()).not.toBe(before);
  await expect(moveHere).toHaveCount(2);
});
