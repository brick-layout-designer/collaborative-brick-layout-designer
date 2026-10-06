// Journey — a club is deleted, and brought back.
//
// Ada runs Rail Club; Ben is a member. The club shared a module in the
// public catalog. Ada deletes the club: the screen says what goes and
// when, she hands the public module to Ben, and types the club's name.
// The club disappears for Ben at once, and he gets a notice saying Ada
// deleted it, when it goes for good, and that it can be restored. Ben
// can't restore it himself; Ada restores it from Clubs › Being deleted,
// and it's back for both of them.

import { test, expect, type Browser, type Page } from '@playwright/test';
import { signIn } from '../../helpers';
import { makeGlobalAdmin } from '../../dbHelpers';

const ts = Date.now();
test.setTimeout(180_000);

async function as(browser: Browser, email: string, name: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email, name);
  return page;
}

async function post(page: Page, url: string, data: object) {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

test('a club admin deletes a club handing its public module to a member; the member is told; an admin restores it', async ({ browser }) => {
  const ADA = `j-clubdel-ada-${ts}@example.com`;
  const BEN = `j-clubdel-ben-${ts}@example.com`;
  const CLUB = `Rail Club ${ts}`;
  const ada = await as(browser, ADA, 'Ada');
  makeGlobalAdmin(ADA);
  const ben = await as(browser, BEN, 'Ben');

  // The club, Ben in it, and a module it shared in the public catalog.
  expect((await ada.request.patch('/api/admin/settings', { data: { moduleCatalogEnabled: true, catalogReview: 'none' } })).ok()).toBe(true);
  const club = await post(ada, '/api/orgs', { name: CLUB });
  const invite = await post(ada, `/api/orgs/${club.slug}/invites`, { email: BEN, role: 'member' });
  await post(ben, `/api/org-invites/${invite.token}`, {});
  await post(ada, '/api/layouts', { title: `Club yard ${ts}`, orgSlug: club.slug });
  const mod = await post(ada, '/api/modules', { title: `Signal box ${ts}`, orgSlug: club.slug });
  const item = await post(ada, '/api/catalog/submissions', { kind: 'module', sourceId: mod.id, title: `Signal box ${ts}` });
  expect(item.status).toBe('public');

  // ---- Ada deletes it ---------------------------------------------------------
  await ada.goto(`/orgs/${club.slug}/admin?tab=settings`);
  await ada.getByRole('button', { name: 'Delete the club…' }).click();
  await expect(ada.getByTestId('delete-club-before')).toContainText('Download the club’s data');
  await ada.getByRole('button', { name: 'Continue to delete…' }).click();
  const confirm = ada.getByTestId('delete-club-confirm');
  await expect(confirm).toContainText('hidden straight away from all 2 members');
  await expect(confirm).toContainText(`Club yard ${ts}`);
  await expect(confirm).toContainText('14 days');
  await expect(confirm).toContainText(`Signal box ${ts}`);
  await expect(confirm).toContainText('Copies people already added to their own things are theirs, and stay either way.');
  await confirm.getByLabel('Hand them to a member').check();
  await confirm.getByLabel('Member who looks after them').selectOption({ label: 'Ben' });
  await confirm.getByLabel(/Type the club’s name/).fill(CLUB);
  await confirm.getByRole('button', { name: 'Delete the club', exact: true }).click();
  await expect(ada).toHaveURL(/\/orgs#being-deleted$/);
  await expect(ada.getByTestId('being-deleted')).toContainText(CLUB);

  // ---- Ben: it's gone from his clubs, and he has a notice ---------------------
  await ben.goto('/orgs');
  await expect(ben.getByText(CLUB, { exact: true }).first()).toBeVisible(); // in Being deleted
  await expect(ben.getByRole('link', { name: CLUB })).toHaveCount(0); // not in Your clubs
  const notice = ben.getByTestId('notice-banner');
  await expect(notice).toContainText(`Ada deleted the club ${CLUB}`);
  await expect(notice).toContainText('gone for good on');
  await expect(notice).toContainText('restore it');
  await expect(ben.getByTestId('being-deleted')).toContainText('Ask one of its admins to restore it.');
  expect((await ben.request.post(`/api/orgs/${club.slug}/restore`)).status()).toBe(404);

  // ---- Ada restores it --------------------------------------------------------
  await ada.getByTestId('being-deleted').getByRole('button', { name: 'Restore' }).click();
  await expect(ada.getByTestId('toast')).toContainText('is back');
  await expect(ada.getByRole('link', { name: CLUB })).toBeVisible();
  await ben.goto('/orgs');
  await expect(ben.getByRole('link', { name: CLUB })).toBeVisible();
  expect((await ben.request.get(`/api/orgs/${club.slug}`)).status()).toBe(200);
});
