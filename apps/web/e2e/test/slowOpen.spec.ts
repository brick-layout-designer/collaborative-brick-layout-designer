// Show Wi-Fi: a layout opened while the connection is down says it hasn't
// opened yet, and opens by itself once the Wi-Fi is back (no reload).

import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';

test('a layout that can\'t reach the server yet opens by itself when the Wi-Fi is back', async ({ page, context }) => {
  test.setTimeout(90_000);
  await signIn(page, `slow-open-${Date.now()}@example.com`, 'Slow Opener');
  const make = async (title: string) =>
    ((await (await page.request.post('/api/layouts', { data: { title } })).json()) as { id: string }).id;
  const first = await make('Warm up');
  const second = await make('Show floor');
  // The editor's code is in: open one layout while online.
  await page.goto(`/editor/${first}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  // The Wi-Fi drops, then the other layout is opened.
  await context.setOffline(true);
  await page.evaluate((id) => {
    history.pushState({}, '', `/editor/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, second);
  await expect(page.getByText("The layout hasn't opened yet")).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('it opens by itself as soon as it gets through')).toBeVisible();

  // Back online: it opens, no reload.
  await context.setOffline(false);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Show floor').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("The layout hasn't opened yet")).toHaveCount(0);
});
