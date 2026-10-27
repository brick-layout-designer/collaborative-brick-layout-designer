// Journey — inviting people to a new club.
//
//   Ada already runs a club with Ben in it. She makes a second club and
//   opens its Invite people form → typing "Ben" finds Ben (they share a
//   club) → typing Stella's name finds no one (they've never worked
//   together), and the form says to send an invite link → Ada types
//   Stella's email, and the invite link is made. The search never says
//   whether someone has an account.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
const ADA = `j-search-ada-${ts}@example.com`;
const BEN = `j-search-ben-${ts}@example.com`;
const STELLA = `j-search-stella-${ts}@example.com`;

async function post(page: Page, url: string, data: object): Promise<Record<string, string>> {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, string>;
}

test('the invite search finds people you work with, and a link reaches anyone else', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, ADA, 'Ada Admin');
  const ben = await browser.newPage();
  await signIn(ben, BEN, `Ben Builder ${ts}`);
  const stella = await browser.newPage();
  await signIn(stella, STELLA, `Stella Stranger ${ts}`);

  const first = await post(page, '/api/orgs', { name: `First Club ${ts}` });
  const invite = await post(page, `/api/orgs/${first.slug}/invites`, { email: BEN, role: 'member' });
  await post(ben, `/api/org-invites/${invite.token}`, {});
  const second = await post(page, '/api/orgs', { name: `Second Club ${ts}` });

  await page.goto(`/orgs/${second.slug}/admin`);
  const box = page.getByLabel('Name or email');
  await expect(box).toHaveAttribute('placeholder', 'Search people you work with, or type an email');

  // Ben shares a club with Ada: found.
  await box.fill('Ben Builder');
  await expect(page.getByRole('button', { name: `Ben Builder ${ts}` })).toBeVisible();

  // Stella has an account, but she and Ada have never worked together: no one found.
  await box.fill('Stella Stranger');
  await expect(page.getByText('No one found — send an invite link instead.')).toBeVisible();
  await expect(page.getByRole('button', { name: `Stella Stranger ${ts}` })).toHaveCount(0);

  // Her email makes an invite link all the same.
  await box.fill(STELLA);
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('button', { name: 'Copy link' }).first()).toBeVisible();

  // Asked straight, the search answers the same for her as for an address with no account.
  const ask = (q: string) => page.request.get(`/api/orgs/${second.slug}/user-search?q=${encodeURIComponent(q)}`);
  expect(await (await ask(STELLA)).json()).toEqual({ users: [] });
  expect(await (await ask(`nobody-${ts}@example.com`)).json()).toEqual({ users: [] });

  await ben.close();
  await stella.close();
});
