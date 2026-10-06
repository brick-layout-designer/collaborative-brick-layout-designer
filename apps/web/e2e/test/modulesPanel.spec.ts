// The Modules panel, as a club member uses it: group some parts as a
// module in this layout, then save it to the Module library. The save says
// so, and the module is on Home where it opens with its parts.

import { test, expect, type Page } from '@playwright/test';
import { signIn, mapMenu } from '../helpers';

const ts = Date.now();
const PART = 'ts_narrowgauge_straight.8';

function brickCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string };
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    return st ? st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-')).length : 0;
  });
}

test('group parts as a module, save it to the Module library, find it on Home', async ({ page }) => {
  await signIn(page, `modpanel-${ts}@example.com`, 'Panel User');
  const res = await page.request.post('/api/layouts', { data: { title: 'Panel layout' } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  for (let i = 0; i < 2; i++) {
    await page.getByPlaceholder(/fuzzy filter/i).first().fill('narrow gauge track straight 4 x 16');
    await page.locator(`[title*="(${PART})"]`).first().dblclick();
  }
  await expect.poll(() => brickCount(page)).toBe(2);

  // Map > Group Selection as Module.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+a');
  page.once('dialog', (d) => void d.accept(`Siding ${ts}`));
  await mapMenu(page, 'Modules & sets', 'Group selection as module');
  await expect(page.getByText(`Grouped “Siding ${ts}” as a module`)).toBeVisible();

  // Modules panel: right-click it > Save to Module library.
  await page.getByRole('button', { name: 'Panels', exact: true }).click();
  await page.getByLabel('Modules', { exact: true }).check();
  await page.mouse.click(400, 400);
  await page.getByText(`Siding ${ts}`, { exact: true }).click({ button: 'right' });
  await expect(page.getByText(`Siding ${ts}`, { exact: true }).locator('..')).toContainText('2 parts');
  await expect(page.getByRole('button', { name: 'Ungroup (keep the parts)' })).toBeVisible();
  await page.getByRole('button', { name: 'Save to Module library' }).click();
  await expect(page.getByText(`Saved “Siding ${ts}” to your Module library`)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(`Siding ${ts}`, { exact: true }).locator('..')).toContainText('in your Module library');

  // Home lists it; it opens with both parts.
  await page.goto('/');
  const row = page.getByTestId('module-row').filter({ hasText: `Siding ${ts}` });
  await row.getByRole('link', { name: `Open Siding ${ts}` }).click();
  await expect.poll(() => brickCount(page), { timeout: 15000 }).toBe(2);
});
