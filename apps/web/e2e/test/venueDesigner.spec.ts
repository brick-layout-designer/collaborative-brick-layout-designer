// E2E: the Venue Designer. Draw a room by typing its size, cut a door into
// it, add a floor outlet and a note, save it to the library, reopen it,
// then open the designer from a layout and save the venue there.

import { test, expect, type Page } from '@playwright/test';
import { ensureUser, signIn } from '../helpers';

const EMAIL = `venue-designer-${Date.now()}@example.com`;

async function clickCanvas(page: Page, fx: number, fy: number): Promise<void> {
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function typeKeys(page: Page, text: string): Promise<void> {
  for (const ch of text) await page.keyboard.press(ch === ' ' ? 'Space' : ch);
}

test.beforeAll(async () => {
  await ensureUser(EMAIL, 'Venue Designer');
});

test('designs a venue from typed sizes and saves it to the library', async ({ page }) => {
  await signIn(page, EMAIL);
  await page.goto('/venues/new');
  await expect(page.getByRole('navigation', { name: 'Tools', exact: true })).toBeVisible();

  // Room: click one corner, type width x depth, Enter.
  await page.keyboard.press('r');
  await clickCanvas(page, 0.2, 0.2);
  await page.mouse.move(600, 600);
  await typeKeys(page, "40'x20'");
  await expect(page.getByText("Typing 40'x20'")).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Venue 40′ 0″ × 20′ 0″')).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  // Floor outlet and a note.
  await page.keyboard.press('p');
  await clickCanvas(page, 0.3, 0.3);
  await expect(inspector.getByText('Power point')).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Floor outlet' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('n');
  await clickCanvas(page, 0.35, 0.35);
  const text = inspector.getByLabel('Text');
  await text.fill('Concessions upstairs');
  await text.press('Enter');
  // Esc in a box leaves it; Esc again leaves the tool, and again the selection.
  await text.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Name it and save: the page moves to the saved venue.
  await inspector.getByLabel('Name').fill('Grand Lobby test');
  await inspector.getByLabel('Name').press('Enter');
  await page.getByRole('button', { name: 'Save venue' }).click();
  await expect(page).toHaveURL(/\/venues\/[^/]+\/design$/);
  await expect(page.getByText('unsaved')).toHaveCount(0);

  // Reopening shows what was saved.
  await page.reload();
  await expect(page.getByText('Grand Lobby test').first()).toBeVisible();
  await expect(page.getByText('Venue 40′ 0″ × 20′ 0″')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: 'Venues', exact: true })).toBeVisible();
  await expect(page.getByText('Grand Lobby test')).toBeVisible();
});

test('undo and redo walk back through each drawing step', async ({ page }) => {
  await signIn(page, EMAIL);
  await page.goto('/venues/new');
  await expect(page.getByRole('navigation', { name: 'Tools', exact: true })).toBeVisible();
  await page.keyboard.press('c');
  await clickCanvas(page, 0.3, 0.3);
  await clickCanvas(page, 0.35, 0.35);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const inspector = page.getByRole('complementary', { name: 'Inspector' });
  const obstacles = inspector.getByText('Obstacles').locator('xpath=following-sibling::span[1]');
  await expect(obstacles).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(obstacles).toHaveText('0');
  await page.keyboard.press('Control+Shift+z');
  await expect(obstacles).toHaveText('1');
});

test("opens from a layout's Map menu and saves the venue into the layout", async ({ page }) => {
  await signIn(page, EMAIL);
  const res = await page.request.post('/api/layouts', { data: { title: 'Designer layout' } });
  expect(res.ok()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000); // live sync settles

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: /Open Venue Designer/ }).click();
  await expect(page.getByRole('navigation', { name: 'Tools', exact: true })).toBeVisible();
  await page.keyboard.press('r');
  await clickCanvas(page, 0.3, 0.3);
  await page.mouse.move(700, 600);
  await typeKeys(page, "30'x15'");
  await page.keyboard.press('Enter');
  await expect(page.getByText('Venue 30′ 0″ × 15′ 0″')).toBeVisible();
  await page.getByRole('button', { name: 'Save to layout' }).click();
  await expect(page.getByText('unsaved')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  // The layout's sidecar now holds the venue, four walls.
  await expect
    .poll(async () => {
      const r = await page.request.get(`/api/layouts/${id}/export.bbm.bld`);
      if (!r.ok()) return 0;
      return (((await r.json()) as { venue?: { edges: unknown[] } }).venue?.edges ?? []).length;
    })
    .toBe(4);
});
