// Journey — when were the club's members last active?
//
// Ada runs Rail Club; Ben is a member. On the club's People tab Ada sees
// roughly when each member last used the site ("active today"), never the
// exact time. Ben would rather not say: in Settings › Privacy he turns off
// "Show club admins when I was last active", and it goes from Ada's list
// at once, without a reload. Turned back on, it's back.

import { test, expect, type Browser, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
test.setTimeout(120_000);

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

test('a club admin sees when members were last active, unless a member hides it', async ({ browser }) => {
  const ada = await as(browser, `j-active-ada-${ts}@example.com`, 'Ada');
  const ben = await as(browser, `j-active-ben-${ts}@example.com`, 'Ben');
  const club = await post(ada, '/api/orgs', { name: `Rail Club ${ts}` });
  const invite = await post(ada, `/api/orgs/${club.slug}/invites`, { email: `j-active-ben-${ts}@example.com`, role: 'member' });
  await post(ben, `/api/org-invites/${invite.token}`, {});

  await ada.goto(`/orgs/${club.slug}/admin?tab=people`);
  const benRow = ada.getByRole('listitem').filter({ hasText: 'Ben' }).filter({ hasText: 'joined' });
  await expect(benRow.getByTestId('last-active')).toHaveText(' · active today');

  // Ben hides it in Settings › Privacy.
  await ben.goto('/settings#privacy');
  const share = ben.getByRole('switch', { name: 'Show club admins when I was last active' });
  await expect(share).toHaveAttribute('aria-checked', 'true');
  await share.click();
  await expect(share).toHaveAttribute('aria-checked', 'false');

  // Gone from Ada's list, which she hasn't reloaded.
  await expect(benRow.getByTestId('last-active')).toHaveCount(0, { timeout: 15_000 });

  // Back on: back again.
  await share.click();
  await expect(benRow.getByTestId('last-active')).toHaveText(' · active today', { timeout: 15_000 });
});
