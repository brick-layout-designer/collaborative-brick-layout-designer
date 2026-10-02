// When the site's firewall (WAF) refuses a request, the app never sees it:
// the answer is a 403 with an empty or non-JSON body. People are told
// that, not "You don't have permission".

import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';

test('a request the firewall blocked says so, not "no permission"', async ({ page }) => {
  await signIn(page, `waf-${Date.now()}@example.com`, 'Firewall');
  await page.route('**/api/layouts', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ status: 403, body: '' }) : route.continue(),
  );
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New layout' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Create/ }).click();
  await expect(dialog.getByText("The site's firewall blocked this request. Please tell the site admin (what you were doing, and the time).")).toBeVisible();
  await expect(page.getByText("You don't have permission to do that.")).toHaveCount(0);
  expect(warnings.some((w) => w.includes('POST /api/layouts'))).toBe(true);
});
