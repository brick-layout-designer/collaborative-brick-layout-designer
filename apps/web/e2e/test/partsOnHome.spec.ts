// E2E: custom parts live on the home page now (the Library page is gone).
// /library lands on the parts section; the section lists mine and my club's
// parts with owner chips under the owner filter; the club's Manage › Parts
// tab links to it filtered to the club; Upload part works from the home
// page and from the editor's Parts panel; the top nav has no Library.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../helpers';

const ts = Date.now();
const ADMIN = `parts-home-${ts}@example.com`;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const XML = Buffer.from('<?xml version="1.0"?><part><Author>e2e</Author></part>').toString('base64');
const CLUB = `Parts Club ${ts}`;
let slug = '';

async function post(page: Page, url: string, data: object): Promise<{ id: string; slug?: string }> {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json() as Promise<{ id: string; slug?: string }>;
}
const part = (partNumber: string, displayName: string, orgSlug?: string) => ({
  partNumber, displayName, xmlBase64: XML, spriteBase64: PNG, spriteMime: 'image/png', ...(orgSlug ? { orgSlug } : {}),
});

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, ADMIN, 'Parts Admin');
  slug = (await post(page, '/api/orgs', { name: CLUB })).slug!;
  await post(page, '/api/custom-parts', part(`MINE${ts}`, 'My Arch'));
  await post(page, '/api/custom-parts', part(`CLUB${ts}`, 'Club Sign', slug));
  await page.close();
});

const parts = (page: Page) => page.locator('#parts');
const row = (page: Page, text: string) => parts(page).getByRole('listitem').filter({ hasText: text });

test('/library lands on the home page’s Custom parts, with owner chips', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/library');
  await expect(page).toHaveURL(/\/#parts$/);
  await expect(parts(page).getByRole('heading', { name: 'Custom parts' })).toBeInViewport();
  await page.getByRole('group', { name: 'Show whose things' }).getByRole('button', { name: 'All' }).click();
  await expect(row(page, 'My Arch').getByTestId('owner-chip')).toHaveText('Me');
  await expect(row(page, 'Club Sign').getByTestId('owner-chip')).toHaveText(CLUB);
  // The club's admin may delete its part.
  await row(page, 'Club Sign').getByRole('button', { name: `More for CLUB${ts}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Download XML' })).toBeVisible();
  // No Library in the top nav any more.
  await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Library' })).toHaveCount(0);
});

test('the club’s Manage › Parts tab links to its parts on the home page', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto(`/orgs/${slug}/admin`);
  await page.getByRole('tab', { name: 'Parts' }).click();
  await page.getByRole('link', { name: 'See them on the home page' }).click();
  await expect(page).toHaveURL(new RegExp(`/\\?owner=${slug}#parts$`));
  await expect(page.getByRole('group', { name: 'Show whose things' }).getByRole('button', { name: CLUB })).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Club Sign')).toBeVisible();
  await expect(row(page, 'My Arch')).toHaveCount(0);
});

test('Upload part from the home page adds it to the list', async ({ page }) => {
  await signIn(page, ADMIN);
  await page.goto('/?owner=me');
  await parts(page).getByRole('button', { name: 'Upload part' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload custom part' });
  await dialog.getByLabel('Part number').fill(`NEW${ts}`);
  await dialog.getByLabel('Display name').fill('Fresh Tree');
  await dialog.getByLabel('Part XML').setInputFiles({ name: 'tree.xml', mimeType: 'text/xml', buffer: Buffer.from(XML, 'base64') });
  await dialog.getByLabel('Sprite (gif or png)').setInputFiles({ name: 'tree.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
  await dialog.getByRole('button', { name: 'Upload' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, 'Fresh Tree').getByTestId('owner-chip')).toHaveText('Me');
});

test('the editor’s Parts panel opens the same upload dialog', async ({ page }) => {
  await signIn(page, ADMIN);
  const layout = await post(page, '/api/layouts', { title: `Parts ${ts}` });
  await page.goto(`/editor/${layout.id}`);
  await page.getByRole('button', { name: 'Upload part…' }).click();
  await expect(page.getByRole('dialog', { name: 'Upload custom part' })).toBeVisible();
  await page.getByRole('dialog', { name: 'Upload custom part' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Upload custom part' })).toHaveCount(0);
});
