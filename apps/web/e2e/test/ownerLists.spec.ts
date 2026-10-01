// E2E: my things and my clubs' things together on the home page. One list
// of layouts, rooms and modules with owner chips; an All · Mine · <club>
// filter that's remembered; Save to defaults to the club shown; the club
// page links back to the list filtered to it; and someone outside the club
// never sees its things.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const ts = Date.now();
const MEMBER = `owners-member-${ts}@example.com`;
const OUTSIDER = `owners-outsider-${ts}@example.com`;
const ROOM = { name: 'Club Hall', enabled: true, edges: [], obstacles: [], minWalkwayStuds: 0 };

async function post(page: Page, url: string, data: object): Promise<{ id: string; slug?: string }> {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<{ id: string; slug?: string }>;
}

let clubSlug = '';

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, MEMBER, 'Owner Member');
  const club = await post(page, '/api/orgs', { name: `Rail Club ${ts}` });
  clubSlug = club.slug!;
  await post(page, '/api/layouts', { title: 'My Town' });
  await post(page, '/api/layouts', { title: 'Club Show', orgSlug: clubSlug });
  await post(page, '/api/venues', { name: 'Club Hall', data: ROOM, orgSlug: clubSlug });
  await post(page, '/api/modules', { title: 'Club Station', orgSlug: clubSlug });
  await post(page, '/api/modules', { title: 'My Siding' });
  await page.close();
});

const row = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });
const filterRow = (page: Page) => page.getByRole('group', { name: 'Show whose things' });

test('home lists mine and my club’s things together with owner chips', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto('/');
  await filterRow(page).getByRole('button', { name: 'All' }).click();
  await expect(row(page, 'My Town').getByTestId('owner-chip')).toHaveText('Me');
  await expect(row(page, 'Club Show').getByTestId('owner-chip')).toHaveText(`Rail Club ${ts}`);
  await expect(row(page, 'Club Hall').getByTestId('owner-chip')).toHaveText(`Rail Club ${ts}`);
  await expect(row(page, 'Club Station').getByTestId('owner-chip')).toHaveText(`Rail Club ${ts}`);
  await expect(row(page, 'My Siding').getByTestId('owner-chip')).toHaveText('Me');
});

test('the owner filter narrows the list and is remembered', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto('/');
  const club = filterRow(page).getByRole('button', { name: `Rail Club ${ts}` });
  await club.click();
  await expect(club).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Club Show')).toBeVisible();
  await expect(page.getByText('My Town')).toHaveCount(0);
  await expect(page.getByText('My Siding')).toHaveCount(0);

  await page.reload();
  await expect(filterRow(page).getByRole('button', { name: `Rail Club ${ts}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Club Show')).toBeVisible();
  await expect(page.getByText('My Town')).toHaveCount(0);

  // New things go to the club being shown.
  await page.getByRole('button', { name: 'New layout' }).click();
  await expect(page.getByLabel('Save to')).toHaveValue(clubSlug);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await filterRow(page).getByRole('button', { name: 'Mine' }).click();
  await expect(page.getByText('My Town')).toBeVisible();
  await expect(page.getByText('Club Show')).toHaveCount(0);
  await page.getByRole('button', { name: 'New layout' }).click();
  await expect(page.getByLabel('Save to')).toHaveValue('');
});

test('the club page links back to the list filtered to the club', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto(`/orgs/${clubSlug}`);
  await page.getByRole('link', { name: 'Open the club’s list' }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?owner=${clubSlug}$`));
  await expect(filterRow(page).getByRole('button', { name: `Rail Club ${ts}` })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Club Show')).toBeVisible();
  await expect(page.getByText('My Town')).toHaveCount(0);
});

test('copies a club layout to me', async ({ page }) => {
  await signIn(page, MEMBER);
  await page.goto('/?owner=all');
  await row(page, 'Club Show').getByRole('button', { name: 'More for Club Show' }).click();
  await row(page, 'Club Show').getByRole('menuitem', { name: 'Move or copy…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Copy to')).toHaveValue('');
  await dialog.getByRole('button', { name: 'Copy' }).click();
  await expect(dialog).toHaveCount(0);
  await filterRow(page).getByRole('button', { name: 'Mine' }).click();
  await expect(row(page, 'Club Show').getByTestId('owner-chip')).toHaveText('Me');
});

test('someone outside the club never sees its things', async ({ page }) => {
  await signIn(page, OUTSIDER, 'Outsider');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Layouts' })).toBeVisible();
  await expect(page.getByText('Club Show')).toHaveCount(0);
  await expect(page.getByText('Club Hall')).toHaveCount(0);
  for (const kind of ['layouts', 'venues', 'modules']) {
    const res = await page.request.get(`/api/${kind}?owner=${clubSlug}`);
    expect(res.status()).toBe(404);
  }
});
