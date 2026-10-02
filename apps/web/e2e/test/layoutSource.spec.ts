// E2E: a .bld-layout saved from a layout on this server offers "Open the
// original" when it's picked in the New layout dialog; one from another
// server doesn't. Making a copy stays the default.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLayoutFile } from '../../src/layoutFile';
import { signIn } from '../helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const BBM = readFileSync(join(FIXTURES, 'tight-corner.bbm'), 'utf8');
const ts = Date.now();

async function pick(page: Page, server: string, layoutId: string) {
  const bytes = await buildLayoutFile({
    bbm: BBM,
    sidecar: null,
    source: { server, layoutId, title: 'Original Show', exportedAt: new Date().toISOString() },
  });
  await page.getByRole('button', { name: 'New layout' }).first().click();
  await page.locator('input[type=file][accept*=".bld-layout"]').setInputFiles({
    name: 'copy.bld-layout',
    mimeType: 'application/x-brick-layout-designer-layout',
    buffer: Buffer.from(bytes),
  });
}

test('a file from a layout on this server offers the original', async ({ page }) => {
  await signIn(page, `source-${ts}@example.com`, 'Sam Source');
  const res = await page.request.post('/api/layouts', { data: { title: `Original Show ${ts}` } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto('/');
  const here = new URL(page.url()).origin;

  await pick(page, here, id);
  const notice = page.getByRole('dialog', { name: 'New layout' }).getByRole('status').filter({ hasText: 'is on this server' });
  await expect(notice).toContainText(`“Original Show ${ts}”`);
  // Making a copy is still there.
  await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  await notice.getByRole('link', { name: 'Open the original' }).click();
  await expect(page).toHaveURL(new RegExp(`/editor/${id}$`));
});

test('a file from another server, or a layout you can’t open, offers no original', async ({ page }) => {
  await signIn(page, `source-${ts}@example.com`, 'Sam Source');
  await page.goto('/');
  await pick(page, 'https://elsewhere.example.org', 'L-1');
  await expect(page.getByRole('dialog', { name: 'New layout' })).toBeVisible();
  await expect(page.getByText('Open the original')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await pick(page, new URL(page.url()).origin, 'no-such-layout');
  await expect(page.getByRole('dialog', { name: 'New layout' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Open the original')).toHaveCount(0);
});
