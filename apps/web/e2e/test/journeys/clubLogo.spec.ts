// Journey — a club gets a logo.
//
// Ada runs Rail Club; Ben is a member. Ada uploads a logo on Manage ›
// Settings: it shows beside the club's name there, and in Ben's Clubs list
// at once, without a reload. An SVG with a script in it is refused, with a
// reason. Ada removes the logo and the club's first letter is back.

import { test, expect, type Browser, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
test.setTimeout(120_000);

// A 4 × 4 red PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWM4IScHRwzEcQCxYxBB16puEAAAAABJRU5ErkJggg==', 'base64');

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

test('a club admin uploads a logo; members see it at once; a scripted SVG is refused', async ({ browser }) => {
  const ada = await as(browser, `j-logo-ada-${ts}@example.com`, 'Ada');
  const ben = await as(browser, `j-logo-ben-${ts}@example.com`, 'Ben');
  const name = `Rail Club ${ts}`;
  const club = await post(ada, '/api/orgs', { name });
  const invite = await post(ada, `/api/orgs/${club.slug}/invites`, { email: `j-logo-ben-${ts}@example.com`, role: 'member' });
  await post(ben, `/api/org-invites/${invite.token}`, {});

  await ben.goto('/orgs');
  const benRow = ben.getByRole('listitem').filter({ has: ben.getByRole('link', { name }) });
  await expect(benRow.getByTestId('club-logo')).toHaveCount(0);

  await ada.goto(`/orgs/${club.slug}/admin?tab=settings`);
  const logo = ada.getByRole('region', { name: 'Logo' });
  await logo.getByLabel('Club logo file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(logo.getByTestId('club-logo')).toBeVisible();
  await expect(ada.getByRole('heading', { level: 1 }).getByTestId('club-logo')).toBeVisible();
  // The picture really loads, as a WebP.
  const src = (await logo.getByTestId('club-logo').getAttribute('src'))!;
  const pic = await ben.request.get(src);
  expect(pic.headers()['content-type']).toBe('image/webp');

  // Ben's list shows it without a reload.
  await expect(benRow.getByTestId('club-logo')).toBeVisible({ timeout: 15_000 });

  // A scripted SVG: refused, and why.
  await logo
    .getByLabel('Club logo file')
    .setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(logo.getByRole('alert')).toContainText('it has a script');

  await logo.getByRole('button', { name: 'Remove logo' }).click();
  await expect(logo.getByTestId('club-logo')).toHaveCount(0);
  await expect(benRow.getByTestId('club-logo')).toHaveCount(0, { timeout: 15_000 });
});
