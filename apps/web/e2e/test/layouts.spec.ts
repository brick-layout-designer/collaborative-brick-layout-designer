// E2E: Layout CRUD — create, rename, delete, and list operations.

import { test, expect, type Page } from '@playwright/test';

const ts = Date.now();
const EMAIL = `layouts-e2e-${ts}@example.com`;
const PASS = 'correct horse battery';

async function loginViaApi(page: Page): Promise<void> {
  await page.request.post('/api/auth/password/register', {
    data: { email: EMAIL, password: PASS, displayName: 'Layouts Tester' },
  });
  await page.request.post('/api/auth/password/login', {
    data: { email: EMAIL, password: PASS },
  });
}

test.describe('layout list page', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test('home page shows empty state when no layouts exist', async ({ page }) => {
    await page.goto('/');
    // Either an empty-state message or an empty list — no layout cards visible.
    const layoutCards = page.getByRole('article').or(page.locator('[data-testid="layout-card"]'));
    await expect(page.locator('body')).toBeVisible();
    // There should not be layout entries since we just registered.
    const count = await layoutCards.count();
    expect(count).toBe(0);
  });

  test('creates a new layout via API and it appears in the list', async ({ page }) => {
    const createRes = await page.request.post('/api/layouts', {
      data: { title: 'My First Layout' },
    });
    expect(createRes.ok()).toBe(true);

    await page.goto('/');
    await expect(page.getByText('My First Layout')).toBeVisible({ timeout: 5000 });
  });

  test('multiple layouts appear in the list', async ({ page }) => {
    await page.request.post('/api/layouts', { data: { title: 'Layout Alpha' } });
    await page.request.post('/api/layouts', { data: { title: 'Layout Beta' } });

    await page.goto('/');
    await expect(page.getByText('Layout Alpha')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Layout Beta')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('layout creation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test('creates a layout via the UI and navigates to the editor', async ({ page }) => {
    await page.goto('/');

    // Click the "New Layout" button — text may vary.
    const newBtn = page
      .getByRole('button', { name: /new layout|create layout|new|create/i })
      .first();
    await newBtn.click();

    // If a dialog appears for the title, fill it.
    const titleInput = page.getByLabel(/title|name/i);
    if (await titleInput.count() > 0) {
      await titleInput.fill('Created from UI');
      await page.getByRole('button', { name: /create|confirm|ok/i }).click();
    }

    // Should end up in the editor.
    await expect(page).toHaveURL(/\/editor\//);
  });

  test('creates a layout via the API and navigates to it directly', async ({ page }) => {
    const res = await page.request.post('/api/layouts', { data: { title: 'Direct Nav Layout' } });
    const { id } = await res.json() as { id: string };

    await page.goto(`/editor/${id}`);
    await expect(page).toHaveURL(`/editor/${id}`);
    // The editor canvas or toolbar should be visible.
    await expect(page.locator('canvas').or(page.locator('[data-testid="toolbar"]'))).toBeVisible({ timeout: 10000 });
  });
});

test.describe('layout rename', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test('renames a layout via the API and the new title appears in the list', async ({ page }) => {
    const createRes = await page.request.post('/api/layouts', { data: { title: 'Original Name' } });
    const { id } = await createRes.json() as { id: string };

    await page.request.patch(`/api/layouts/${id}`, { data: { title: 'Renamed Layout' } });

    await page.goto('/');
    await expect(page.getByText('Renamed Layout')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Original Name')).not.toBeVisible();
  });
});

test.describe('layout deletion', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaApi(page);
  });

  test('deletes a layout via the API and it disappears from the list', async ({ page }) => {
    const createRes = await page.request.post('/api/layouts', { data: { title: 'To Be Deleted' } });
    const { id } = await createRes.json() as { id: string };

    // Verify it appears first.
    await page.goto('/');
    await expect(page.getByText('To Be Deleted')).toBeVisible({ timeout: 5000 });

    await page.request.delete(`/api/layouts/${id}`);

    // After reload it must be gone.
    await page.reload();
    await expect(page.getByText('To Be Deleted')).not.toBeVisible();
  });

  test('navigating to a deleted layout shows a 404-style error', async ({ page }) => {
    const createRes = await page.request.post('/api/layouts', { data: { title: 'Gone' } });
    const { id } = await createRes.json() as { id: string };
    await page.request.delete(`/api/layouts/${id}`);

    await page.goto(`/editor/${id}`);
    // Should show an error — not the editor.
    await expect(page.locator('canvas')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/not found|error|unavailable/i).or(page.locator('h1'))).toBeVisible({ timeout: 5000 });
  });
});
