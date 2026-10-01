// E2E: an admin sets a site-wide limit in Settings, a person who reaches
// it sees a friendly message naming it, the admin finds them under Heavy
// use, makes them read-only and lifts it again.

import { test, expect } from '@playwright/test';
import { signIn } from '../helpers';
import { makeGlobalAdmin } from '../dbHelpers';

const ts = Date.now();
const ADMIN = `limits-admin-${ts}@example.com`;
const USER = `limits-user-${ts}@example.com`;

test('limits: set one, reach it, then read-only and back', async ({ page, browser }) => {
  await signIn(page, ADMIN, 'Limits Admin');
  makeGlobalAdmin(ADMIN);
  const user = await browser.newPage();
  await signIn(user, USER, `Lim User ${ts}`);
  expect((await user.request.post('/api/layouts', { data: { title: `First ${ts}` } })).ok()).toBe(true);

  try {
    // Settings: one personal layout each.
    await page.goto('/admin');
    await page.getByRole('button', { name: 'settings' }).click();
    await expect(page.getByRole('heading', { name: 'Usage limits' })).toBeVisible();
    await page.getByLabel('Layouts per person').fill('1');
    await page.getByRole('button', { name: 'Save limits' }).click();
    await expect(page.getByText(/Saved\. New limits apply right away/)).toBeVisible();

    // The person tries a second layout and is told why, in plain words.
    await user.goto('/');
    await user.getByRole('button', { name: 'New layout' }).first().click();
    await user.getByRole('button', { name: 'Create' }).click();
    await expect(user.getByText('You have 1 layout, the most allowed. Delete one you don’t need, or ask the site admin for more.')).toBeVisible();

    // Heavy use: the person shows up; open them and make them read-only.
    await page.getByRole('button', { name: 'heavy use' }).click();
    const people = page.getByRole('region', { name: /Top people/ });
    await expect(people).toBeVisible();
    await people.getByRole('button', { name: `Lim User ${ts}` }).first().click();
    await expect(page.getByRole('heading', { name: 'Use and limits' })).toBeVisible();
    await expect(page.getByText('1 of 1').first()).toBeVisible();
    await page.getByPlaceholder('Reason (optional)').fill('checking');
    await page.getByRole('button', { name: 'Make read-only' }).click();
    await expect(page.getByRole('button', { name: 'Lift read-only' })).toBeVisible();
    const blocked = await user.request.post('/api/orgs', { data: { name: `Nope ${ts}` } });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).message).toMatch(/read-only/);
    // Reading still works.
    expect((await user.request.get('/api/layouts')).ok()).toBe(true);

    await page.getByRole('button', { name: 'Lift read-only' }).click();
    await expect(page.getByRole('button', { name: 'Make read-only' })).toBeVisible();
    await expect(page.getByText(/turned on read-only for/).first()).toBeVisible();
  } finally {
    // Shared test server: put the site-wide value back.
    await page.request.patch('/api/admin/limits', { data: { layoutsPerUser: null } });
  }
});
