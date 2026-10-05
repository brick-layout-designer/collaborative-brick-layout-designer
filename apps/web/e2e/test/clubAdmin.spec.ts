// E2E: a club admin runs the club from its Manage page: settings, inviting
// with an expiry, the activity feed, handing over, and deleting the club
// with its name typed out. A member sees the club page without the
// admin's tools and can leave.

import { test, expect, type Page } from '@playwright/test';
import { signIn, confirmInDialog } from '../helpers';

const ts = Date.now();
const ADMIN = `club-admin-${ts}@example.com`;
const MEMBER = `club-member-${ts}@example.com`;

async function post(page: Page, url: string, data: object) {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<Record<string, string>>;
}

async function clubWithMember(page: Page, member: Page, name: string): Promise<string> {
  const club = await post(page, '/api/orgs', { name });
  const invite = await post(page, `/api/orgs/${club.slug}/invites`, { email: MEMBER, role: 'member' });
  await post(member, `/api/org-invites/${invite.token}`, {});
  return club.slug!;
}

test('an admin changes settings, invites with an expiry and sees it in the activity', async ({ page, browser }) => {
  await signIn(page, ADMIN, 'Ada Admin');
  const member = await browser.newPage();
  await signIn(member, MEMBER, 'Max Member');
  const slug = await clubWithMember(page, member, `Train Club ${ts}`);

  await page.goto(`/orgs/${slug}`);
  await page.getByRole('link', { name: 'Manage the club' }).click();
  await expect(page.getByRole('heading', { name: `Manage Train Club ${ts}` })).toBeVisible();
  await expect(page.getByRole('region', { name: /Members/ }).getByText('Max Member', { exact: true })).toBeVisible();

  // Invite for 7 days; it waits to join with its link.
  await page.getByLabel('Name or email').fill(`new-${ts}@example.com`);
  await page.getByLabel('Link works for').selectOption('7');
  await page.getByRole('button', { name: 'Send invite' }).click();
  await expect(page.getByRole('button', { name: 'Copy link' }).first()).toBeVisible();
  const pending = page.getByRole('region', { name: /Waiting to join/ });
  await expect(pending.getByText(`new-${ts}@example.com`)).toBeVisible();
  await expect(pending.getByText(/expires in 7 days/)).toBeVisible();

  // Settings: a description, and only admins may add things.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('About the club').fill('We meet on Tuesdays.');
  await page.getByRole('checkbox', { name: /Members can add/ }).uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  const res = await member.request.post('/api/layouts', { data: { title: 'Nope', orgSlug: slug } });
  expect(res.status()).toBe(403);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText(`Ada Admin invited new-${ts}@example.com`)).toBeVisible();
  await expect(page.getByText('Ada Admin changed the club’s settings')).toBeVisible();

  // The member sees the description, no admin tools, and can leave.
  await member.goto(`/orgs/${slug}`);
  await expect(member.getByText('We meet on Tuesdays.')).toBeVisible();
  await expect(member.getByRole('link', { name: 'Manage the club' })).toHaveCount(0);
  await member.getByRole('button', { name: 'Leave the club' }).click();
  await confirmInDialog(member);
  await expect(member).toHaveURL(/\/orgs$/);
  await member.close();
});

test('an admin hands the club over, and the new admin deletes it with its name typed out', async ({ page, browser }) => {
  await signIn(page, ADMIN, 'Ada Admin');
  const member = await browser.newPage();
  await signIn(member, MEMBER, 'Max Member');
  const name = `Hand Club ${ts}`;
  const slug = await clubWithMember(page, member, name);

  await page.goto(`/orgs/${slug}/admin`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  // The only admin can't just leave.
  await page.getByRole('button', { name: 'Leave the club' }).click();
  await expect(page.getByRole('alert')).toContainText('only admin');

  await page.getByLabel('New admin').selectOption({ label: 'Max Member' });
  await page.getByRole('button', { name: 'Hand over' }).click();
  await confirmInDialog(page);
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}$`));
  await expect(page.getByText('you are a member')).toBeVisible();

  await member.goto(`/orgs/${slug}/admin`);
  await member.getByRole('tab', { name: 'Settings' }).click();
  const del = member.getByRole('button', { name: 'Delete club' });
  await expect(del).toBeDisabled();
  await member.getByLabel(/Type the club’s name/).fill(name);
  await del.click();
  await expect(member).toHaveURL(/\/orgs$/);
  expect((await member.request.get(`/api/orgs/${slug}`)).status()).toBe(404);
  await member.close();
});
