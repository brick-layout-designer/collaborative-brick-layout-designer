// Journey — a privacy request by email. Rosa, a site admin, gets an email
// from Theo asking for a copy of his data. She logs it in Admin › Privacy
// requests (picking his account), sees it due in a month, exports his
// data and downloads the zip to send him, and marks it done. The history
// shows each step.

import { test, expect } from '@playwright/test';
import { signIn, ensureUser, fromSettingsMenu } from '../../helpers';
import { makeGlobalAdmin } from '../../dbHelpers';

const ts = Date.now();
test.setTimeout(180_000);

test('an admin logs a privacy request, exports the person’s data and closes it', async ({ page }) => {
  const ADMIN = `j-rosa-${ts}@example.com`;
  const THEO = `j-theo-${ts}@example.com`;
  await ensureUser(THEO, `Theo ${ts}`);
  await signIn(page, ADMIN, 'Rosa');
  makeGlobalAdmin(ADMIN);

  await page.goto('/');
  await fromSettingsMenu(page, /^Privacy requests/);
  await expect(page).toHaveURL(/\/admin\?tab=privacy/);
  await page.getByRole('button', { name: 'Log a request' }).click();
  const form = page.getByTestId('privacy-log-form');
  await form.getByLabel('What they ask').selectOption('access');
  await form.getByLabel('Search accounts').fill(`Theo ${ts}`);
  await form.getByRole('button', { name: new RegExp(`Theo ${ts}`) }).click();
  await form.getByLabel('Notes (optional)').fill('Asked by email for a copy of his data');
  await form.getByRole('button', { name: 'Log it' }).click();

  const detail = page.getByTestId('privacy-request-detail');
  await expect(detail).toContainText('See their data (access)');
  await expect(detail).toContainText(THEO);
  await detail.getByRole('button', { name: 'Export their data' }).click();
  const download = detail.getByRole('link', { name: 'Download' });
  await expect(download).toBeVisible({ timeout: 30_000 });
  const zip = await page.request.get((await download.getAttribute('href'))!);
  expect(zip.ok()).toBe(true);
  expect(zip.headers()['content-type']).toBe('application/zip');

  await detail.getByLabel('Status').selectOption('done');
  await expect(detail.getByTestId('privacy-history')).toHaveCount(3);
  await expect(detail.getByTestId('privacy-history').nth(1)).toContainText('Started their data download');
  await expect(detail.getByTestId('privacy-history').nth(2)).toContainText('open → done');

  // Closed: it leaves the open list.
  await detail.getByRole('button', { name: '← All requests' }).click();
  await expect(page.getByTestId('privacy-request-row').filter({ hasText: THEO })).toHaveCount(0);
});
