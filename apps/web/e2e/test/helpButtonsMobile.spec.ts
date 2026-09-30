// Help on a phone: there's no hover, so tapping a "?" opens its popover;
// the popover fits the screen with no sideways scrolling; the "?" is a
// 44 px tap target even though the circle looks smaller; tapping outside
// closes it; and the Help menu fits the screen too.
// SHOTS_DIR=<dir> also saves a phone screenshot of the popover.

import { test, expect, devices } from '@playwright/test';
import { signIn } from '../helpers';

// A phone's touch screen and user agent, in whichever browser the project
// runs, at the narrowest common phone width (360 px; the iPhone 14 is 390).
const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 14'];
test.use({ ...iPhone, viewport: { width: 360, height: 740 } });

const SHOTS = process.env.SHOTS_DIR;

test('tapping a "?" on a phone opens a popover that fits, and tapping outside closes it', async ({ page }) => {
  await signIn(page, `help-phone-${Date.now()}@example.com`, 'Phone Tester');
  const res = await page.request.post('/api/layouts', { data: { title: 'Phone Help Layout' } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const vw = page.viewportSize()!.width;
  expect(vw).toBeLessThanOrEqual(430);

  const help = page.locator('[data-help-key="topbar.saveStatus"]');
  await expect(help).toBeVisible();

  // A 44 px tap target, whatever the circle looks like.
  const box = (await help.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await help.tap();
  const pop = page.getByRole('dialog', { name: 'Saving' });
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('If you go offline, keep working');

  // It fits the screen, and the page doesn't scroll sideways.
  const popBox = (await pop.boundingBox())!;
  expect(popBox.x).toBeGreaterThanOrEqual(0);
  expect(popBox.x + popBox.width).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // Its buttons are easy to hit too.
  const showMe = (await pop.getByRole('button', { name: 'Show me' }).boundingBox())!;
  expect(showMe.height).toBeGreaterThanOrEqual(44);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-help-phone-popover.png` });

  // Tapping somewhere else closes it.
  await page.locator('main').tap({ position: { x: 40, y: 40 } });
  await expect(pop).toHaveCount(0);

  // The Help menu opens with a tap and fits the screen.
  await page.getByRole('button', { name: 'Help', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Help' });
  await expect(menu.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(vw);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-help-phone-menu.png` });
  await menu.getByRole('button', { name: 'Turn help buttons off' }).tap();
  await expect(page.locator('[data-help-key]')).toHaveCount(0);
});
