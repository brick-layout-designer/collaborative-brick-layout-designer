// Journey — club roles, two people in two browsers (and the admin on a phone).
//
//   Ada makes a club and invites Ben as a member → on the Roles tab (with
//   its first-time hint) Ada makes "Track crew", which can only edit
//   layouts → on People she gives Ben Track crew and takes Member away →
//   Ben opens a club layout and can edit it (no "View only") → Ben's New
//   module can't go to the club, and says why → Ada, on her phone, sees the
//   role and its one member, with nothing running off the screen.

import { test, expect, devices, type Page } from '@playwright/test';
import { signIn } from '../../helpers';
import { findOverflow } from '../../mobileChecks';

const ts = Date.now();
const ADA = `j-roles-ada-${ts}@example.com`;
const BEN = `j-roles-ben-${ts}@example.com`;
const CLUB = `Roles Club ${ts}`;
const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];

async function post(page: Page, url: string, data: object): Promise<Record<string, string>> {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<string, string>;
}

test('an admin makes a Track crew role that edits layouts but adds no modules', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, ADA, 'Ada Admin');
  const ben = await browser.newPage();
  await signIn(ben, BEN, 'Ben Builder');
  const club = await post(page, '/api/orgs', { name: CLUB });
  const invite = await post(page, `/api/orgs/${club.slug}/invites`, { email: BEN, role: 'member' });
  await post(ben, `/api/org-invites/${invite.token}`, {});
  const layout = await post(page, '/api/layouts', { title: `Club yard ${ts}`, orgSlug: club.slug! });

  // ── Roles: the hint the first time, then a new role with one box ticked. ──
  await page.goto(`/orgs/${club.slug}/admin`);
  await page.getByRole('tab', { name: 'Roles' }).click();
  const hint = page.getByTestId('roles-hint');
  await expect(hint).toContainText('Roles decide what people can do in the club.');
  await hint.getByRole('button', { name: 'Got it' }).click();
  await expect(hint).toHaveCount(0);
  await page.getByRole('button', { name: 'New role' }).click();
  const form = page.getByRole('form', { name: 'New role' });
  await form.getByLabel('Role name').fill('Track crew');
  await form.getByRole('checkbox', { name: /Edit club layouts/ }).check();
  await form.getByRole('button', { name: 'Add role' }).click();
  const roles = page.getByRole('list', { name: 'Club roles' });
  await expect(roles.getByRole('listitem').filter({ hasText: 'Track crew' })).toContainText('0 members');

  // ── People: Ben gets Track crew, and loses Member. ──
  await page.getByRole('tab', { name: 'People' }).click();
  const chips = page.getByRole('group', { name: 'Roles for Ben Builder' });
  await chips.getByRole('button', { name: '+ Track crew' }).click();
  await expect(chips.getByRole('button', { name: '✓ Track crew' })).toBeVisible();
  await chips.getByRole('button', { name: '✓ Member' }).click();
  await expect(chips.getByRole('button', { name: '+ Member' })).toBeVisible();
  // Track crew is now his only role, so it can't be taken.
  await expect(chips.getByRole('button', { name: '✓ Track crew' })).toBeDisabled();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Ada Admin made the Track crew role')).toBeVisible();
  await expect(page.getByText(/Ada Admin gave Ben Builder the Track crew role/)).toBeVisible();

  // ── Ben edits the club's layout… ──
  await ben.goto(`/editor/${layout.id}`);
  await expect(ben.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect(ben.getByTestId('view-only')).toHaveCount(0);
  // …but his new module can't go to the club, and he's told why.
  await ben.goto('/');
  await ben.getByRole('button', { name: 'New module' }).click();
  const dialog = ben.getByRole('dialog', { name: 'New module' });
  await expect(dialog.getByTestId('clubs-left-out')).toHaveText(
    `${CLUB} isn’t listed: your roles there can’t add modules. Ask a club admin for the Add or edit modules permission.`,
  );
  const refused = await ben.request.post('/api/modules', { data: { title: 'Bridge', orgSlug: club.slug } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ permission: 'edit_modules' });
  await ben.close();

  // ── On a phone: Ada sees the role with its one member, nothing off the screen. ──
  const phone = await browser.newContext({ ...pixel7 });
  const mobile = await phone.newPage();
  await signIn(mobile, ADA, 'Ada Admin');
  await mobile.goto(`/orgs/${club.slug}/admin?tab=roles`);
  const list = mobile.getByRole('list', { name: 'Club roles' });
  await expect(list.getByRole('listitem').filter({ hasText: 'Track crew' })).toContainText('1 member');
  await list.getByRole('listitem').filter({ hasText: 'Track crew' }).getByRole('button', { name: 'Edit' }).tap();
  await expect(mobile.getByRole('form', { name: 'Edit Track crew' }).getByRole('checkbox', { name: /Edit club layouts/ })).toBeChecked();
  expect(await findOverflow(mobile)).toEqual([]);
  await phone.close();
});
