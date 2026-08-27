// E2E: Authentication flows — register, login, logout, and redirect behaviour.
// Tests in this file share a unique email per run to stay isolated.

import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `auth-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

test.describe('auth — register', () => {
  test('registers a new account and lands on the home page', async ({ page }) => {
    await page.goto('/login');

    // The register toggle is a <button>, not a link — "Need an account?"
    // flips PasswordForm's internal mode from 'login' to 'register',
    // which also swaps the submit button's label to "Create account".
    await page.getByRole('button', { name: /need an account/i }).click();

    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASS);

    await page.getByRole('button', { name: /create account/i }).click();
    await expect(page).toHaveURL('/');
    // The login form has no display-name field, so the server defaults
    // displayName to the email itself — that's what should show as
    // logged-in confirmation somewhere in the header/nav.
    await expect(page.getByText(EMAIL).first()).toBeVisible({ timeout: 5000 });
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

test.describe('auth — login', () => {
  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logs in with correct credentials and lands on home', async ({ page, request }) => {
    // Register via a separate, cookie-isolated request context — the
    // register endpoint auto-logs-in (sets a session cookie on its
    // response), and `page.request` shares cookie storage with `page`.
    // Registering through `page.request` directly would leave the
    // browser already authenticated, so `page.goto('/login')` below
    // would immediately redirect to `/` before the form ever renders.
    await request.post('/api/auth/password/register', {
      data: { email: `login-${ts}@example.com`, password: PASS, displayName: 'Login User' },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`login-${ts}@example.com`);
    await page.getByLabel(/password/i).fill(PASS);
    await page.getByRole('button', { name: /log.?in|sign.?in/i }).click();
    await expect(page).toHaveURL('/');
  });

  test('shows an error with wrong password', async ({ page, request }) => {
    // Register via a cookie-isolated context — see the previous test's
    // comment: registering through `page.request` would auto-log-in the
    // browser (the endpoint sets a session cookie), which would redirect
    // `/login` straight to `/` before the form ever renders.
    await request.post('/api/auth/password/register', {
      data: { email: `badpass-${ts}@example.com`, password: PASS, displayName: 'Bad Pass' },
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`badpass-${ts}@example.com`);
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
    // Register + login via API.
    await page.request.post('/api/auth/password/register', {
      data: { email: `logout-${ts}@example.com`, password: PASS, displayName: 'Logout User' },
    });
    const loginRes = await page.request.post('/api/auth/password/login', {
      data: { email: `logout-${ts}@example.com`, password: PASS },
    });
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
    await page.request.post('/api/auth/password/register', {
      data: { email: `profile-${ts}@example.com`, password: PASS, displayName: 'Profile User' },
    });
    await page.request.post('/api/auth/password/login', {
      data: { email: `profile-${ts}@example.com`, password: PASS },
    });
    await page.goto('/profile');
    // Profile page should render with the user's email somewhere visible.
    await expect(page.getByText(`profile-${ts}@example.com`)).toBeVisible({ timeout: 5000 });
  });
});
