// The editor's dialogs and the keyboard: Escape closes every one of them,
// and while one is open the map's keys (Delete, R, the arrows) leave the
// picked parts alone, wherever the focus is. Delete with the focus on the
// page used to delete the picked part behind an open dialog.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, mapMenu } from '../helpers';

const FORDYCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);

/** Fordyce's sheets with one 9V curve on the first brick sheet and nothing else. */
function oneCurve(): string {
  const brick =
    '<Brick id="900"><DisplayArea><X>0</X><Y>0</Y><Width>16</Width><Height>8</Height></DisplayArea>' +
    '<MyGroup /><PartNumber>2867.8</PartNumber><Orientation>0</Orientation>' +
    '<ActiveConnectionPointIndex>0</ActiveConnectionPointIndex><Altitude>0</Altitude><Connexions count="0" /></Brick>';
  const first = /<Layer type="brick"[\s\S]*?<\/Layer>/.exec(FORDYCE)![0];
  const layer = first.replace(/<Bricks>[\s\S]*<\/Bricks>/, `<Bricks>${brick}</Bricks>`);
  return FORDYCE.replace(/<Layer type="(brick|ruler|text)"[\s\S]*?<\/Layer>/g, '').replace(/(<Layers[^>]*>)/, `$1${layer}`);
}

const count = (page: Page) =>
  page.evaluate(() => {
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: { name: () => string; getClassName: () => string }) => boolean) => unknown[] }[] } }).Konva?.stages[0];
    return st ? st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-')).length : 0;
  });

test('Escape closes the dialogs, and the map keys wait while one is open', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page, `dialog-keys-${Date.now()}@example.com`, 'Dialog Keys');
  const res = await page.request.post('/api/layouts', { data: { title: 'Dialog keys', bbm: oneCurve() } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => count(page)).toBe(1);

  // Every entry that opens a dialog closes with Escape.
  for (const [path, name] of [
    [['General info…'], 'General info'],
    [['Background color…'], 'Background color'],
    [['Background image…'], 'Background image'],
    [['Download & export', 'Export as image…'], 'Export / Print'],
    [['Modules & sets', 'Import .bbm as module…'], 'Import .bbm as module'],
    [['Preferences…'], 'Preferences'],
  ] as const) {
    await mapMenu(page, ...path);
    const dialog = page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }

  // Pick the part (Ctrl+A), open a dialog, put the focus back on the page: Delete, R and the arrows do nothing.
  const area = (await page.locator('.konvajs-content').first().boundingBox())!;
  await page.mouse.click(area.x + 5, area.y + area.height - 5);
  await page.keyboard.press('Control+a');
  await expect(page.locator('footer')).toContainText('selected: 1');
  await mapMenu(page, 'General info…');
  await expect(page.getByRole('dialog', { name: 'General info' })).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const key of ['Delete', 'Backspace', 'r', 'ArrowRight']) await page.keyboard.press(key);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'General info' })).toHaveCount(0);
  expect(await count(page)).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo' }).first()).toBeDisabled();
  // With no dialog, Delete deletes it.
  await page.keyboard.press('Delete');
  await expect.poll(() => count(page)).toBe(0);
});
