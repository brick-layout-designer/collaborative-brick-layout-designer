import { type Page, expect } from '@playwright/test';

export const TEST_EMAIL = `e2e-${Date.now()}@example.com`;
export const TEST_PASS = 'correct horse battery';

/** Register a new account and land on the layouts page. */
export async function register(
  page: Page,
  email = TEST_EMAIL,
  password = TEST_PASS,
  displayName = 'E2E User',
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('link', { name: /register|sign up|create account/i }).click();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  const nameField = page.getByLabel(/display name|name/i);
  if (await nameField.count() > 0) await nameField.fill(displayName);
  await page.getByRole('button', { name: /register|sign up|create/i }).click();
  await expect(page).toHaveURL('/');
}

/** Log in with existing credentials. */
export async function login(
  page: Page,
  email = TEST_EMAIL,
  password = TEST_PASS,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /log in|sign in|login/i }).click();
  await expect(page).toHaveURL('/');
}

/** Create a layout via the UI and return its ID extracted from the URL. */
export async function createLayout(page: Page, title = 'E2E Layout'): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /new layout|create layout|\+/i }).click();
  // Some UIs show a dialog; others create immediately.
  const titleInput = page.getByLabel(/title|name/i);
  if (await titleInput.count() > 0) {
    await titleInput.fill(title);
    await page.getByRole('button', { name: /create|confirm|ok/i }).click();
  }
  await page.waitForURL(/\/editor\//);
  const url = new URL(page.url());
  return url.pathname.split('/editor/')[1] ?? '';
}
