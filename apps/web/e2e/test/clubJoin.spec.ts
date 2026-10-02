// E2E: a club admin lets people ask to join and lists the club; someone
// outside finds it under Find a club, asks with a note, and sees "Request
// sent"; the admin sees the count on Clubs, approves, and the newcomer is
// in. An open club takes people with one click; an unlisted one stays
// hidden.
//
// CLUB_JOIN_SCREENS=<dir> also saves screenshots (light and dark, desktop
// and phone) of the setting, the directory, a request and approving it.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const ts = Date.now();
const ADMIN = `join-admin-${ts}@example.com`;
const ASKER = `join-asker-${ts}@example.com`;
const SCREENS = process.env.CLUB_JOIN_SCREENS;

async function post(page: Page, url: string, data: object, method: 'post' | 'patch' = 'post') {
  const res = await page.request[method](url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<Record<string, string>>;
}

/** Light and dark, at the page's size and at a phone's. */
async function shoot(page: Page, name: string) {
  if (!SCREENS) return;
  const size = page.viewportSize()!;
  for (const [suffix, w, h] of [['desktop', size.width, size.height], ['phone', 390, 844]] as const) {
    await page.setViewportSize({ width: w, height: h });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${SCREENS}/${name}-${suffix}-${scheme}.png`, fullPage: true });
    }
  }
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: 'light' });
}

test('an admin lets people ask; someone finds the club, asks, and is approved', async ({ page, browser }) => {
  // Sixteen full-page screenshots need longer than the default.
  if (SCREENS) test.setTimeout(180_000);
  await signIn(page, ADMIN, 'Ada Admin');
  const asker = await browser.newPage();
  await signIn(asker, ASKER, 'Rita Rails');
  const name = `Rail Club ${ts}`;
  const club = await post(page, '/api/orgs', { name });
  const slug = club.slug!;
  await post(page, `/api/orgs/${slug}`, { description: 'Trains on Tuesdays in Little Rock.' }, 'patch');

  // Not listed yet: nobody outside can find it.
  await asker.goto('/orgs');
  await asker.getByLabel('Search clubs').fill(`Rail Club ${ts}`);
  await expect(asker.getByText('No listed club matches that.')).toBeVisible();
  await asker.goto(`/orgs/${slug}`);
  await expect(asker.getByText('Club not found.')).toBeVisible();

  // The admin: Ask to join, and show in the club list.
  await page.goto(`/orgs/${slug}/admin`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const join = page.getByRole('region', { name: 'Who can join' });
  await expect(join.getByRole('radio', { name: /Invite only/ })).toBeChecked();
  await join.getByRole('radio', { name: /Ask to join/ }).check();
  await expect(join.getByRole('note')).toContainText('still need an invite');
  await join.getByRole('checkbox', { name: /Show in the club list/ }).check();
  await shoot(page, 'manage-who-can-join');
  await join.getByRole('button', { name: 'Save' }).click();
  await expect(join.getByText('Saved.')).toBeVisible();

  // The asker finds it, asks with a note, and can see the request is sent.
  await asker.goto('/orgs');
  await asker.getByLabel('Search clubs').fill(`Rail Club ${ts}`);
  const row = asker.getByRole('list', { name: 'Listed clubs' }).getByRole('listitem').filter({ hasText: name });
  await expect(row.getByText('1 member')).toBeVisible();
  await expect(row.getByText('Trains on Tuesdays')).toBeVisible();
  await shoot(asker, 'find-a-club');
  await row.getByRole('button', { name: 'Ask to join' }).click();
  await row.getByLabel(/A note to the admins/).fill('I bring a lot of track.');
  await row.getByRole('button', { name: 'Send request' }).click();
  await expect(row.getByText('Request sent')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  // The club page shows the public summary, not the members-only page.
  await asker.goto(`/orgs/${slug}`);
  await expect(asker.getByRole('heading', { name })).toBeVisible();
  await expect(asker.getByText('Request sent')).toBeVisible();
  await expect(asker.getByText('The club’s things')).toHaveCount(0);

  // The admin sees the count on Clubs, and approves.
  await page.goto('/orgs');
  await expect(page.getByRole('navigation', { name: 'Site' }).getByLabel('1 request to join')).toBeVisible();
  await page.getByRole('link', { name: '1 request to join', exact: true }).click();
  const requests = page.getByRole('region', { name: /Requests to join/ });
  await expect(requests.getByText('Rita Rails')).toBeVisible();
  await expect(requests.getByText('“I bring a lot of track.”')).toBeVisible();
  await shoot(page, 'request-waiting');
  await requests.getByRole('button', { name: 'Approve' }).click();
  await expect(requests.getByText('Rita Rails is now a member.')).toBeVisible();
  await expect(page.getByRole('region', { name: /Members/ }).getByText('Rita Rails', { exact: true })).toBeVisible();
  await shoot(page, 'request-approved');

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Ada Admin let Rita Rails join')).toBeVisible();

  // Rita is in.
  await asker.goto(`/orgs/${slug}`);
  await expect(asker.getByText('The club’s things')).toBeVisible();
  await asker.close();
});

test('an open listed club takes people with one click; members can’t change who joins', async ({ page, browser }) => {
  await signIn(page, ADMIN, 'Ada Admin');
  const asker = await browser.newPage();
  await signIn(asker, ASKER, 'Rita Rails');
  const name = `Open Club ${ts}`;
  const club = await post(page, '/api/orgs', { name });
  await post(page, `/api/orgs/${club.slug}`, { joinPolicy: 'open', listed: true }, 'patch');

  await asker.goto('/orgs');
  await asker.getByLabel('Search clubs').fill(name);
  const row = asker.getByRole('listitem').filter({ hasText: name });
  await row.getByRole('button', { name: 'Join' }).click();
  await expect(asker).toHaveURL(new RegExp(`/orgs/${club.slug}$`));
  await expect(asker.getByText('you are a member')).toBeVisible();

  const res = await asker.request.patch(`/api/orgs/${club.slug}`, { data: { joinPolicy: 'invite' } });
  expect(res.status()).toBe(403);
  await asker.close();
});
