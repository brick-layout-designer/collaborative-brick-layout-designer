// The web app installs like an app: Chrome finds nothing missing in its
// manifest, and Settings shows how to install it.

import { devices, expect, test } from '@playwright/test';

// A Pixel 7, without its browser choice (the project picks Chromium).
const { defaultBrowserType: _browser, ...PHONE } = devices['Pixel 7']!;

test('a computer has no install section, and the switches keep their shape', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Help and tours' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Install the app' })).toHaveCount(0);
  const track = await page.getByTestId('switch-track').first().boundingBox();
  expect(track).toMatchObject({ width: 56, height: 32 });
});

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the switch stays a pill inside its 44 px tap target', async ({ page }) => {
    await page.goto('/settings');
    const sw = page.getByRole('switch', { name: 'Show help buttons' });
    await expect(sw).toBeVisible({ timeout: 15000 });
    const button = (await sw.boundingBox())!;
    const track = (await page.getByTestId('switch-track').first().boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(track).toMatchObject({ width: 56, height: 32 });
    // Centred in the button.
    expect(Math.abs(track.y + track.height / 2 - (button.y + button.height / 2))).toBeLessThan(1);
  });
});

test.describe('installing on a phone', () => {
  test.use(PHONE);

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
});
