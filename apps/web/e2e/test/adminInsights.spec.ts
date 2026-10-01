// E2E: the platform admin's dashboard — range picker, needs-attention
// panel, accessible graphs with table fallbacks, CSV export, and a
// phone-width layout without sideways scrolling.

import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { makeGlobalAdmin } from '../dbHelpers';

const ts = Date.now();
const ADMIN = `site-admin-${ts}@example.com`;
const PLAIN = `not-admin-${ts}@example.com`;

test('a site admin reads the dashboard, changes the range and downloads a table', async ({ page }) => {
  await signIn(page, ADMIN, 'Site Admin');
  makeGlobalAdmin(ADMIN);
  // A layout so the content numbers have something in them.
  const res = await page.request.post('/api/layouts', { data: { title: `Dash ${ts}` } });
  expect(res.ok()).toBe(true);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '30 days' })).toHaveAttribute('aria-checked', 'true');

  // Each graph is an image named by its text summary, with a table behind it.
  const newPeople = page.getByRole('region', { name: 'New people' });
  await expect(newPeople.getByRole('img')).toHaveAttribute('aria-label', /^New people: /);
  await newPeople.getByText('Show as table').click();
  await expect(newPeople.getByRole('row')).toHaveCount(31);

  await page.getByRole('radio', { name: '7 days' }).click();
  await expect(page.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true');
  await expect(newPeople.getByRole('row')).toHaveCount(8);

  // Keyboard: arrow keys walk the graph and show a readout.
  await newPeople.getByRole('img').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(newPeople.getByRole('status')).toBeVisible();

  // CSV download of a table.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Largest layouts as CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('largest-layouts.csv');

  // The range survives a reload.
  await page.reload();
  await expect(page.getByRole('radio', { name: '7 days' })).toHaveAttribute('aria-checked', 'true');
  // Content tables fill from the server (the layout made above counts).
  await expect(page.getByRole('region', { name: 'Largest layouts' }).getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Server' }).getByText('Version')).toBeVisible();
});

test('the dashboard fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, ADMIN, 'Site Admin');
  makeGlobalAdmin(ADMIN);
  await page.goto('/admin');
  await expect(page.getByRole('region', { name: 'New people' })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll('main *')];
    return els.some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible' && el.getBoundingClientRect().right > window.innerWidth + 1);
  });
  expect(overflow).toBe(false);
  for (const name of ['7 days', '30 days', '90 days', '12 months']) {
    const box = await page.getByRole('radio', { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('people who are not site admins are kept out', async ({ page }) => {
  await signIn(page, PLAIN);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0);
  const res = await page.request.get('/api/admin/stats/series');
  expect(res.status()).toBe(403);
});
