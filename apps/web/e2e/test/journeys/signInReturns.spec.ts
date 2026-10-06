// Journey — signing in comes back to the link you followed.
//
//   1. A club link opened signed out goes to sign-in and, after it, to
//      the club (not Home).
//   2. Someone new follows a club invite: Sign in → Need an account → the
//      emailed link takes them on to the invite, which lets them in.
//   3. Signed in as someone else: "Sign out and use that account" comes
//      back to the invite. A used invite says what to do and has a way
//      Home. An unknown address says so instead of an empty page.
//   4. A failed GitHub/Google sign-in lands on the sign-in page with a
//      reason.

import { test, expect, type Page } from '@playwright/test';
import { PASS, signIn, submitAuthForm } from '../../helpers';
import { getVerificationToken } from '../../dbHelpers';

const ts = Date.now();
const ADMIN = `j-next-admin-${ts}@example.com`;
const NEWBIE = `j-next-new-${ts}@example.com`;
const OTHER = `j-next-other-${ts}@example.com`;
const CLUB = `Return Club ${ts}`;

async function post(page: Page, url: string, data: unknown) {
  const res = await page.request.post(url, { data });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBe(true);
  return res.json();
}

test('sign-in, sign-up and invites come back to the link that was followed', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, ADMIN, 'Ada');
  const club = await post(admin, '/api/orgs', { name: CLUB });

  // ── 1. A club link, signed out. ──
  const ada = await (await browser.newContext()).newPage();
  await ada.goto(`/orgs/${club.slug}`);
  await expect(ada).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/orgs/${club.slug}`)}$`));
  await ada.getByLabel('Email').fill(ADMIN);
  await ada.getByLabel('Password').fill(PASS);
  await submitAuthForm(ada, '/api/auth/password/login', () => ada.getByRole('button', { name: 'Sign in', exact: true }).click());
  await expect(ada).toHaveURL(new RegExp(`/orgs/${club.slug}$`));
  await expect(ada.getByRole('heading', { name: CLUB })).toBeVisible();

  // ── 2. Someone new follows an invite. ──
  const invite = await post(admin, `/api/orgs/${club.slug}/invites`, { email: NEWBIE, role: 'member' });
  const invitePath = `/org-invite/${invite.token}`;
  const newbie = await (await browser.newContext()).newPage();
  await newbie.goto(invitePath);
  await newbie.getByRole('link', { name: `Sign in as ${NEWBIE}` }).click();
  await newbie.getByRole('button', { name: 'Need an account?' }).click();
  await newbie.getByLabel('Your name (shown to others)').fill('Nina');
  await newbie.getByLabel('Email').fill(NEWBIE);
  await newbie.getByLabel('Password').fill(PASS);
  const reg = await submitAuthForm(newbie, '/api/auth/password/register', () => newbie.getByRole('button', { name: 'Create account' }).click());
  // The sign-up says where to go once the email is confirmed.
  expect(reg.request().postDataJSON()).toMatchObject({ next: invitePath });
  await expect(newbie.getByText('for a confirmation link')).toBeVisible();
  const token = await getVerificationToken(NEWBIE);
  await newbie.goto(`/verify-email/${token}?next=${encodeURIComponent(invitePath)}`);
  await expect(newbie).toHaveURL(new RegExp(`/orgs/${club.slug}$`), { timeout: 15_000 });
  await expect(newbie.getByRole('heading', { name: CLUB })).toBeVisible();

  // ── 3. The wrong account, a used invite, an unknown address. ──
  const second = await post(admin, `/api/orgs/${club.slug}/invites`, { email: `someone-else-${ts}@example.com`, role: 'member' });
  const other = await (await browser.newContext()).newPage();
  await signIn(other, OTHER, 'Otto');
  await other.goto(`/org-invite/${second.token}`);
  await other.getByRole('button', { name: 'Sign out and use that account' }).click();
  await expect(other).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/org-invite/${second.token}`)}$`));

  await newbie.goto(invitePath);
  await expect(newbie.getByText('This invite isn\'t valid.')).toBeVisible();
  await expect(newbie.getByText('Ask whoever sent you the invite for a new one.')).toBeVisible();
  await newbie.getByRole('link', { name: 'Go to Home' }).click();
  await expect(newbie).toHaveURL(/\/$/);

  await newbie.goto('/no-such-page');
  await expect(newbie.getByRole('heading', { name: 'Page not found' })).toBeVisible();

  // Signed out, a venue (kept in an account) asks to sign in first.
  await other.goto('/venues/new');
  await expect(other).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent('/venues/new')}$`));

  // ── 4. A GitHub/Google sign-in that failed. ──
  await other.goto('/login?error=invalid_state');
  await expect(other.getByRole('alert')).toContainText('That sign-in took too long');
});
