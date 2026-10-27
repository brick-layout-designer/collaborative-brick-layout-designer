// E2E: picking parts on a big layout. Select all (Ctrl+A) on Fordyce 2026
// (about 940 parts) draws every halo with one overlay shape over the parts,
// like the desktop's SelectionOverlay, and adds no shapes to the parts
// themselves; dragging picked parts takes a copy of the overlay onto the
// drag layer so their halos move with them, and it goes when they drop.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FORDYCE_BBM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);

type KonvaWin = { Konva: { stages: { findOne: (s: string) => KNode | undefined; find: (s: string) => KNode[] }[] } };
type KNode = { find: (s: string | ((n: KNode) => boolean)) => KNode[]; getLayer: () => { name: () => string } | null; getClientRect: () => { x: number; y: number; width: number; height: number }; name: () => string };

/** Nodes on the parts layer, overlays on each layer, and how many parts are picked. */
async function counts(page: Page) {
  return page.evaluate(() => {
    const stage = (window as unknown as KonvaWin).Konva.stages[0]!;
    const parts = stage.findOne('.parts-layer')!;
    const overlays = stage.find('.selection-overlay').map((n) => n.getLayer()?.name() ?? '');
    return { shapes: parts.find(() => true).length, overlays };
  });
}

test('Select all on a big layout draws the halos in one overlay, which follows a drag', async ({ page }) => {
  test.slow();
  await signIn(page, `select-all-${Date.now()}@example.com`, 'Picker');
  const res = await page.request.post('/api/layouts', { data: { title: 'Fordyce', bbm: FORDYCE_BBM } });
  expect(res.ok()).toBe(true);
  const id = ((await res.json()) as { id: string }).id;
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  const before = await counts(page);
  expect(before.overlays).toEqual(['parts-layer']);

  await page.keyboard.press('Control+a');
  const del = page.getByRole('button', { name: 'Delete', description: 'Delete (Del)' });
  await expect(del).toBeEnabled();
  // Every part picked, and not one shape added to them: the overlay draws the halos.
  const picked = await counts(page);
  expect(picked.shapes).toBe(before.shapes);

  // Drag one picked part: the overlay's copy rides on the drag layer meanwhile.
  const box = await page.evaluate(() => {
    const stage = (window as unknown as KonvaWin).Konva.stages[0]!;
    const groups = stage.find('Group').filter((g) => g.name().startsWith('brick-'));
    const r = groups[Math.floor(groups.length / 2)]!.getClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const canvas = (await page.locator('.konvajs-content').first().boundingBox())!;
  await page.mouse.move(canvas.x + box.x, canvas.y + box.y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + box.x + 20, canvas.y + box.y + 10, { steps: 4 });
  await page.mouse.move(canvas.x + box.x + 40, canvas.y + box.y + 20, { steps: 4 });
  await expect.poll(async () => (await counts(page)).overlays.sort()).toEqual(['drag-layer', 'parts-layer']);
  await page.mouse.up();
  await expect.poll(async () => (await counts(page)).overlays).toEqual(['parts-layer']);

  // Select none: still nothing added or left behind.
  await page.keyboard.press('Control+Shift+a');
  await expect(del).toBeDisabled();
  expect((await counts(page)).shapes).toBe(before.shapes);
});
