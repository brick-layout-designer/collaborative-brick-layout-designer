// A big layout with a mouse: how much drawing a pan, a turn of the wheel and
// a box-select do, counted (not timed, so it holds on any machine).
//
//  - Panning with the middle button and zooming with the wheel draw the hit
//    canvas (what a click lands on) once when the view stops, not on every
//    frame; a click straight after the wheel still picks the part under it.
//  - Dragging a box redraws no part: only the box. It used to redraw every
//    part (and the grid) on each mouse move, as the rulers and grid lines
//    came along with new point arrays.
//  - Export as image gives a real PNG of the size asked for.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, mapMenu } from '../helpers';

const FORDYCE_BBM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);

type Counts = { hits: number; partsScene: number; otherScene: number };

/** Counts hit-canvas shape draws, and scene draws on the parts sheet and elsewhere, from now. */
async function count(page: Page): Promise<() => Promise<Counts>> {
  await page.evaluate(() => {
    type S = { drawHit: (...a: unknown[]) => unknown; drawScene: (...a: unknown[]) => unknown; __hit?: (...a: unknown[]) => unknown; __scene?: (...a: unknown[]) => unknown; getLayer: () => { name: () => string } | null };
    const w = window as unknown as { Konva: { Shape: { prototype: S } }; __n: Counts };
    w.__n = { hits: 0, partsScene: 0, otherScene: 0 };
    const p = w.Konva.Shape.prototype;
    p.__hit ??= p.drawHit;
    p.__scene ??= p.drawScene;
    const hit = p.__hit;
    const scene = p.__scene;
    p.drawHit = function (this: S, ...a: unknown[]) {
      w.__n.hits++;
      return hit.apply(this, a);
    };
    p.drawScene = function (this: S, ...a: unknown[]) {
      if (this.getLayer()?.name() === 'parts-layer') w.__n.partsScene++;
      else w.__n.otherScene++;
      return scene.apply(this, a);
    };
  });
  return () => page.evaluate(() => ({ ...(window as unknown as { __n: Counts }).__n }));
}

/** Draws every listening layer's hit canvas once; how many shapes that is. */
async function oneHitDraw(page: Page): Promise<number> {
  const done = await count(page);
  await page.evaluate(() => {
    const st = (window as unknown as { Konva: { stages: { getLayers: () => { isListening: () => boolean; drawHit: () => void }[] }[] } }).Konva.stages[0]!;
    for (const l of st.getLayers()) if (l.isListening()) l.drawHit();
  });
  return (await done()).hits;
}

/** The screen point of a part near the view's centre, big enough to click. */
function partNearCentre(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; getClientRect: () => { x: number; y: number; width: number; height: number } };
    const st = (window as unknown as { Konva: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva.stages[0]!;
    const b = st.container().getBoundingClientRect();
    let best: { x: number; y: number; d: number } | null = null;
    for (const n of st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))) {
      const r = n.getClientRect();
      if (r.width < 12 || r.height < 12) continue;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 40 || y < 40 || x > b.width - 40 || y > b.height - 40) continue;
      const d = Math.hypot(x - b.width / 2, y - b.height / 2);
      if (!best || d < best.d) best = { x: b.left + x, y: b.top + y, d };
    }
    return best;
  });
}

test('a big layout: pan, zoom and box-select draw what changed, and the export is a real PNG', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await signIn(page, `big-work-${Date.now()}@example.com`, 'Big Work');
  const res = await page.request.post('/api/layouts', { data: { title: 'Big work', bbm: FORDYCE_BBM } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 60000 });
  await expect(page.getByText('940 pieces').first()).toBeVisible();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(800);
  const area = (await page.locator('.konvajs-content').first().boundingBox())!;
  const c = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const once = await oneHitDraw(page);
  expect(once).toBeGreaterThan(900);

  // ── Pan with the middle button: the hit canvas once, at the end. ──
  let done = await count(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: 'middle' });
  for (let i = 1; i <= 20; i++) await page.mouse.move(c.x + i * 5, c.y + i * 3);
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);
  const pan = await done();
  expect(pan.partsScene, 'the parts redraw as the view moves').toBeGreaterThan(900);
  expect(pan.hits, 'the hit canvas: once when the pan ends (it was every frame)').toBeLessThanOrEqual(1.5 * once);

  // ── The wheel: the same, and a click straight after picks the part under it. ──
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(500);
  done = await count(page);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, i < 4 ? -100 : 100);
    await page.waitForTimeout(30);
  }
  const part = await partNearCentre(page);
  expect(part).not.toBeNull();
  await page.mouse.click(part!.x, part!.y);
  await expect(page.locator('footer')).toContainText(/selected: 1\b/);
  await page.waitForTimeout(400);
  const zoom = await done();
  expect(zoom.hits, 'the hit canvas: once or twice, not on every turn of the wheel').toBeLessThanOrEqual(2.5 * once);
  await page.keyboard.press('Escape');

  // ── A box-select drag: the box moves, the parts don't redraw. ──
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(500);
  await page.mouse.move(area.x + 3, area.y + 3);
  await page.mouse.down();
  await page.mouse.move(area.x + 10, area.y + 10);
  await page.waitForTimeout(100);
  done = await count(page);
  for (let i = 1; i <= 15; i++) await page.mouse.move(area.x + 10 + (area.width * 0.45 * i) / 15, area.y + 10 + ((area.height - 20) * i) / 15);
  await page.waitForTimeout(100);
  const drag = await done();
  await page.mouse.up();
  await expect(page.locator('footer')).toContainText(/selected: \d{2,}/);
  expect(drag.partsScene, 'no part redraws while the box moves (it was every part, every move)').toBeLessThan(50);
  expect(drag.otherScene, 'nor the grid').toBeLessThan(15 * 30);

  // ── Export as image: a real PNG, the size asked for. ──
  await mapMenu(page, 'Download & export', 'Export as image…');
  const dialog = page.getByRole('dialog', { name: 'Export / Print' });
  await dialog.getByLabel('Width (px)').fill('1200');
  const height = Number(await dialog.getByLabel('Height (px)').inputValue());
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export PNG' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Big_work.png');
  const png = readFileSync((await file.path())!);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, height]);
});
