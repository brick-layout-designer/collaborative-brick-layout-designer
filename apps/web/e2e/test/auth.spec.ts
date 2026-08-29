// E2E: Authentication flows — register, email verification, login,
// logout, and redirect behaviour.
//
// Registration no longer logs the user straight in (see
// apps/server/src/routes/auth/password.ts) — it creates an unverified
// account and emails a verification link. Since Playwright can't
// receive that email, these tests pull the live token directly from
// the server's own SQLite DB via dbHelpers.ts (Node-side, not a
// browser action) to click the equivalent of the emailed link.
//
// Tests in this file share a unique email per run to stay isolated.

import { test, expect } from '@playwright/test';
import { getVerificationToken, expireVerificationToken } from '../dbHelpers';

const ts = Date.now();
const EMAIL = `auth-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

test.describe('auth — register', () => {
  test('registering shows a check-your-inbox state, not an immediate login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /need an account/i }).click();
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /create account/i }).click();

    // Stays on /login (no session yet) and tells the user to check email.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(EMAIL)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/check/i)).toBeVisible();
  });

  test('rejects registration with a too-short password', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /need an account/i }).click();

    await page.getByLabel(/email/i).fill(`weak-${ts}@example.com`);
    await page.getByLabel(/password/i).fill('abc');

    await page.getByRole('button', { name: /create account/i }).click();
    // Should stay on the login/register page and show an error — the
    // input's own `minLength={8}` blocks native form submission (no
    // request round-trip needed for this to hold).
    await expect(page).not.toHaveURL('/');
  });
});

test.describe('auth — email verification', () => {
  test('clicking the verification link logs the user in', async ({ page, request }) => {
    const email = `verify-${ts}@example.com`;
    // Register via a cookie-isolated context — see the login-test
    // comment below for why `page.request` isn't used here.
    await request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Verify User' },
    });

    const token = await getVerificationToken(email);
    await page.goto(`/verify-email/${token}`);
    await expect(page).toHaveURL('/', { timeout: 5000 });
    // The header shows the account's displayName, not its email.
    await expect(page.getByText('Verify User').first()).toBeVisible({ timeout: 5000 });
  });

  test('an expired verification link shows an error, not a login', async ({ page, request }) => {
    const email = `expired-${ts}@example.com`;
    await request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Expired User' },
    });
    const token = await getVerificationToken(email);
    await expireVerificationToken(email);

    await page.goto(`/verify-email/${token}`);
    await expect(page.getByText(/expired/i)).toBeVisible({ timeout: 5000 });
    await expect(page).not.toHaveURL('/');
  });

  test('a bogus verification token shows an error', async ({ page }) => {
    await page.goto('/verify-email/not-a-real-token-at-all');
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 5000 });
  });

  test('resend button on the login page issues a new working token', async ({ page }) => {
    const email = `resend-${ts}@example.com`;

    // Register through the UI itself — this is what actually creates the
    // first token; no separate pre-registration needed (and doing one
    // via the API first would just 409 this form submission instead).
    await page.goto('/login');
    await page.getByRole('button', { name: /need an account/i }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page.getByText(/check/i)).toBeVisible({ timeout: 5000 });

    const firstToken = await getVerificationToken(email);

    await page.getByRole('button', { name: /resend/i }).click();
    await expect(page.getByText(/sent/i)).toBeVisible({ timeout: 5000 });

    const secondToken = await getVerificationToken(email);
    expect(secondToken).not.toBe(firstToken);

    await page.goto(`/verify-email/${secondToken}`);
    await expect(page).toHaveURL('/', { timeout: 5000 });
  });
});

test.describe('auth — login', () => {
  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logging in before verifying shows an error with a resend option', async ({ page, request }) => {
    const email = `unverified-${ts}@example.com`;
    await request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Unverified User' },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /log.?in|sign.?in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/verify your email/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /resend/i })).toBeVisible();
  });

  test('logs in with correct credentials and lands on home', async ({ page, request }) => {
    // Register via a separate, cookie-isolated request context.
    // `page.request` shares cookie storage with `page`, and even though
    // register no longer sets a cookie, using the isolated context keeps
    // this test robust to that changing back — either way we want the
    // browser itself to start signed out so `page.goto('/login')` below
    // renders the form instead of redirecting to `/`.
    const email = `login-${ts}@example.com`;
    await request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Login User' },
    });
    const token = await getVerificationToken(email);
    await request.post(`/api/auth/password/verify-email/${token}`);

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /log.?in|sign.?in/i }).click();
    await expect(page).toHaveURL('/');
  });

  test('shows an error with wrong password', async ({ page, request }) => {
    const email = `badpass-${ts}@example.com`;
    await request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Bad Pass' },
    });
    const token = await getVerificationToken(email);
    await request.post(`/api/auth/password/verify-email/${token}`);

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill('wrong-password-xyz');
    await page.getByRole('button', { name: /log.?in|sign.?in/i }).click();
    // Should stay on /login and show a human-readable error — NOT the raw
    // "/api/auth/password/login → 401" that used to leak straight from
    // api.ts's Error.message into the form (see api.ts's friendlyErrorMessage).
    await expect(page).toHaveURL(/\/login/);
    const error = page.getByText(/incorrect email or password/i);
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/→\s*401/)).toHaveCount(0);
    await expect(page.getByText('/api/auth/password/login')).toHaveCount(0);
  });

  test('shows an error for unknown email', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`nobody-${ts}@example.com`);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /log.?in|sign.?in/i }).click();
    await expect(page).toHaveURL(/\/login/);
    // Same credential-check error either way — the server doesn't reveal
    // whether the email exists, so the friendly message is identical to
    // the wrong-password case.
    const error = page.getByText(/incorrect email or password/i);
    await expect(error).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/→\s*401/)).toHaveCount(0);
  });
});

test.describe('auth — logout', () => {
  test('logs out and redirects to /login', async ({ page }) => {
    const email = `logout-${ts}@example.com`;
    await page.request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Logout User' },
    });
    const token = await getVerificationToken(email);
    const loginRes = await page.request.post(`/api/auth/password/verify-email/${token}`);
    expect(loginRes.ok()).toBe(true);

    // Navigate home — should work.
    await page.goto('/');
    await expect(page).toHaveURL('/');

    // Click the logout button.
    const logoutBtn = page.getByRole('button', { name: /log.?out|sign.?out/i });
    await logoutBtn.click();
    await expect(page).toHaveURL(/\/login/);

    // After logout, revisiting / must redirect.
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('auth — profile page', () => {
  test('profile page is accessible after login', async ({ page }) => {
    const email = `profile-${ts}@example.com`;
    await page.request.post('/api/auth/password/register', {
      data: { email, password: PASS, displayName: 'Profile User' },
    });
    const token = await getVerificationToken(email);
    await page.request.post(`/api/auth/password/verify-email/${token}`);
    await page.goto('/profile');
    // Profile page should render with the user's email somewhere visible.
    await expect(page.getByText(email)).toBeVisible({ timeout: 5000 });
  });
});
