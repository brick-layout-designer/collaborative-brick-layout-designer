// Journey 2 — club life, two members in two browsers.
//
//   Ada creates a club in the UI and lets people ask to join → Rita finds it
//   and asks → Ada approves and makes her a Manager → Rita makes a club
//   layout from Home (the club filter picks the club) → Ada moves one of her
//   own layouts into the club → Rita sees both under the club filter, and
//   copies one to herself → Ada hands the club over to Rita.

import { test, expect, type Page } from '@playwright/test';
import { signIn, confirmInDialog } from '../../helpers';

const ts = Date.now();
const ADA = `j-club-ada-${ts}@example.com`;
const RITA = `j-club-rita-${ts}@example.com`;
const CLUB = `Rail Club ${ts}`;

const filterRow = (page: Page) => page.getByRole('group', { name: 'Show whose things' });
const row = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });

async function newLayout(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New layout', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New layout' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
}

test('a club from creation to hand-over', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, ADA, 'Ada Admin');
  const rita = await browser.newPage();
  await signIn(rita, RITA, 'Rita Rails');

  // ── Ada creates the club and lets people ask to join. ──
  await page.goto('/orgs');
  await page.getByRole('button', { name: 'New club' }).click();
  await page.getByPlaceholder('Acme Bricks').fill(CLUB);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: CLUB })).toBeVisible({ timeout: 15000 });
  const slug = /\/orgs\/([^/?#]+)/.exec(page.url())?.[1] ?? '';
  expect(slug).not.toBe('');
  await page.goto(`/orgs/${slug}/admin`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  const join = page.getByRole('region', { name: 'Who can join' });
  await join.getByRole('radio', { name: /Ask to join/ }).check();
  await join.getByRole('checkbox', { name: /Show in the club list/ }).check();
  await join.getByRole('button', { name: 'Save' }).click();
  await expect(join.getByText('Saved.')).toBeVisible();

  // ── Rita finds it and asks. ──
  await rita.goto('/orgs');
  await rita.getByLabel('Search clubs').fill(CLUB);
  const listed = rita.getByRole('list', { name: 'Listed clubs' }).getByRole('listitem').filter({ hasText: CLUB });
  await listed.getByRole('button', { name: 'Ask to join' }).click();
  await listed.getByRole('button', { name: 'Send request' }).click();
  await expect(listed.getByText('Request sent')).toBeVisible();

  // ── Ada approves her and makes her a Manager. ──
  await page.goto('/orgs');
  await page.getByRole('link', { name: '1 request to join', exact: true }).click();
  const requests = page.getByRole('region', { name: /Requests to join/ });
  await requests.getByRole('button', { name: 'Approve' }).click();
  await expect(requests.getByText('Rita Rails is now a member.')).toBeVisible();
  await page.getByLabel('Role for Rita Rails').selectOption({ label: 'Manager' });
  await page.reload();
  await expect(page.getByLabel('Role for Rita Rails')).toHaveValue('manager');

  // ── Rita, a Manager: the club's things on Home; a club layout. ──
  await rita.goto('/');
  // Home opens on All the first time, even now she's in a club.
  await expect(filterRow(rita).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await filterRow(rita).getByRole('button', { name: CLUB }).click();
  await rita.getByRole('button', { name: 'New layout', exact: true }).first().click();
  await expect(rita.getByLabel('Save to')).toHaveValue(slug);
  await rita.getByRole('button', { name: 'Cancel' }).click();
  await newLayout(rita, `Club Show ${ts}`);
  // A Manager can open Manage and invite people.
  await rita.goto(`/orgs/${slug}/admin`);
  await expect(rita.getByText('You’re a manager of this club.')).toBeVisible();
  await expect(rita.getByRole('heading', { name: 'Invite people' })).toBeVisible();
  await expect(rita.getByRole('tab', { name: 'Settings' })).toHaveCount(0);

  // ── Ada moves one of her own layouts into the club. ──
  await page.goto('/');
  await filterRow(page).getByRole('button', { name: 'Mine' }).click();
  await newLayout(page, `Ada yard ${ts}`);
  await page.goto('/?owner=all');
  await row(page, `Ada yard ${ts}`).getByRole('button', { name: `More for Ada yard ${ts}` }).click();
  await row(page, `Ada yard ${ts}`).getByRole('menuitem', { name: 'Move or copy…' }).click();
  const move = page.getByRole('dialog');
  await move.getByRole('radio', { name: /^Move to a club/ }).check();
  await move.getByRole('combobox').selectOption({ label: CLUB });
  await move.getByRole('button', { name: /^Move/ }).click();
  // Moving her own layout in says what that means first: the club owns it, she stays its author.
  await expect(page.getByTestId('confirm-dialog')).toContainText(`${CLUB} will own this.`);
  await confirmInDialog(page);
  await expect(move).toHaveCount(0);

  // ── Rita sees both under the club; copies the show layout to herself. ──
  await rita.goto('/');
  // …and after that on the last one she picked.
  await expect(filterRow(rita).getByRole('button', { name: CLUB })).toHaveAttribute('aria-pressed', 'true');
  await expect(row(rita, `Club Show ${ts}`)).toBeVisible();
  await expect(row(rita, `Ada yard ${ts}`)).toBeVisible();
  await row(rita, `Club Show ${ts}`).getByRole('button', { name: `More for Club Show ${ts}` }).click();
  await row(rita, `Club Show ${ts}`).getByRole('menuitem', { name: 'Move or copy…' }).click();
  const copy = rita.getByRole('dialog');
  await expect(copy.getByLabel('Copy to')).toHaveValue('');
  await copy.getByRole('button', { name: 'Copy' }).click();
  await expect(copy).toHaveCount(0);
  await filterRow(rita).getByRole('button', { name: 'Mine' }).click();
  await expect(row(rita, `Club Show ${ts}`).getByTestId('owner-chip')).toHaveText('Me');

  // ── Ada hands the club over to Rita. ──
  await page.goto(`/orgs/${slug}/admin`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('New admin').selectOption({ label: 'Rita Rails (a manager)' });
  await page.getByRole('button', { name: 'Hand over' }).click();
  await confirmInDialog(page);
  await expect(page).toHaveURL(new RegExp(`/orgs/${slug}$`));
  await rita.goto(`/orgs/${slug}/admin`);
  await rita.getByRole('tab', { name: 'Settings' }).click();
  await expect(rita.getByRole('button', { name: 'Delete club' })).toBeVisible();
  await rita.close();
});
