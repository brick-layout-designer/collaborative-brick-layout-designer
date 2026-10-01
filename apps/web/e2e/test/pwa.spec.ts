// The web app installs like an app: Chrome finds nothing missing in its
// manifest, and Settings shows how to install it.

import { expect, test } from '@playwright/test';

test('Chrome can install it, and Settings says how', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'installability is a Chrome check');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Install the app' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('install-state')).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  // The manifest is fetched after load; give Chrome a moment to read it.
  await expect
    .poll(async () => {
      const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; data?: string; errors: unknown[] };
      return manifest.data ? (JSON.parse(manifest.data) as { name: string }).name : null;
    })
    .toBe('Brick Layout Designer');
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[];
  };
  expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});
