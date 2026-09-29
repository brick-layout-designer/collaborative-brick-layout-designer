// E2E: LDraw / TrackDesigner / 4DBrix maps (F1, F2) — opening one from
// the New layout dialog or by dropping it, and Download As with the
// lossy-format warning. The conversions themselves are checked against
// vanilla BlueBrick in @cld/parts-catalog; this checks the app wiring
// with the real parts catalog.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf-8');
const EMAIL = `mapformats-e2e-${Date.now()}@example.com`;

const countPart = (bbm: string, part: string) => bbm.split(`<PartNumber>${part}</PartNumber>`).length - 1;
const brickLines = (ldr: string) => ldr.split('\r\n').filter((l) => l.startsWith('1 ')).length;

async function exportedBbm(page: Page): Promise<string> {
  const id = page.url().split('/editor/')[1]!;
  return (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
}

test.describe('opening other map formats', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, EMAIL, 'Map Formats Tester');
  });

  test('the New layout dialog opens an LDraw file', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New layout' }).click();
    await page.locator('input[type=file][accept*=".ldr"]').setInputFiles({
      name: 'tight-corner.ldr',
      mimeType: 'text/plain',
      buffer: Buffer.from(fixture('oracle/tight-corner.ldr')),
    });
    await expect(page.getByLabel('Title')).toHaveValue('tight-corner');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    // As many of each part as vanilla BlueBrick read from the same file.
    const vanilla = fixture('oracle/tight-corner.from-ldr.bbm');
    await expect.poll(async () => countPart(await exportedBbm(page), '2865.8')).toBe(countPart(vanilla, '2865.8'));
    expect(countPart(await exportedBbm(page), '3811.10')).toBe(countPart(vanilla, '3811.10'));
  });

  test('a dropped 4DBrix file opens, and what it skipped shows in the status bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    const ncp = fixture('oracle/fourdbrix.ncp').replace(
      '</data>',
      '   <table>\r\n      <coordinates x="0" y="0"/>\r\n      <svgfile value="no-such-table.svg"/>\r\n   </table>\r\n</data>',
    );
    await page.evaluate((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], 'show.ncp', { type: 'application/xml' }));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, ncp);
    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    await expect(page.locator('footer')).toContainText(
      'Opened with warnings: No part is mapped to these 4DBrix parts: no-such-table.svg',
      { timeout: 15000 },
    );
    const vanilla = fixture('oracle/fourdbrix.from-ncp.bbm');
    await expect.poll(async () => (await exportedBbm(page)).split('<Brick ').length).toBe(vanilla.split('<Brick ').length);
  });
});

test.describe('Download As', () => {
  test('warns before a lossy format, then writes it; "Don\'t show this again" sticks', async ({ page }) => {
    await signIn(page, EMAIL, 'Map Formats Tester');
    const res = await page.request.post('/api/layouts', { data: { title: 'Maps', bbm: fixture('tight-corner.bbm') } });
    const { id } = (await res.json()) as { id: string };
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Download As...' }).click();
    const dialog = page.getByRole('dialog', { name: 'Download As' });
    await dialog.getByLabel('LDraw (.ldr)').check();
    await expect(dialog).toContainText("This format can't store everything in the map");
    await dialog.getByLabel("Don't show this again").check();
    let dl = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download anyway' }).click();
    let download = await dl;
    expect(download.suggestedFilename()).toBe('Maps.ldr');
    const ldr = readFileSync(await download.path(), 'utf-8');
    expect(ldr.startsWith('0 Maps\r\n0 Name: Maps.ldr\r\n')).toBe(true);
    // One line per brick, as vanilla BlueBrick wrote for the same layout.
    expect(brickLines(ldr)).toBe(brickLines(fixture('oracle/tight-corner.ldr')));

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Download As...' }).click();
    await dialog.getByLabel('TrackDesigner (.tdl)').check();
    await expect(dialog).not.toContainText("can't store everything");
    dl = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    download = await dl;
    expect(download.suggestedFilename()).toBe('Maps.tdl');
    // TrackDesigner file version 20 at byte 12.
    expect(readFileSync(await download.path()).readInt32LE(12)).toBe(20);
  });
});
