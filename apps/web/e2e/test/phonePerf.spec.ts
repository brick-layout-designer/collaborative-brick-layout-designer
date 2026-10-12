// The big layout on a phone: Fordyce (940 parts) on a Pixel 7 with its CPU
// slowed 4x. It opens, pans, pinches, drags a part, picks everything and
// opens Sheets within loose time budgets. While fingers move the view, Konva
// doesn't redraw its hit canvas (what a touch would land on); it's drawn
// once they let go, so a tap right after picks the part under it.
//
// The budgets are loose on purpose (CI machines vary, and CI runs the dev
// build): they catch something that got many times slower, not 10%.
// PERF_LOG=1 prints the measurements.

import { test, expect, devices, type Page, type CDPSession } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FORDYCE_BBM = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);
const { defaultBrowserType: _a, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

type Pt = { x: number; y: number };

class Finger {
  constructor(private cdp: CDPSession) {}
  private send(type: string, pts: Pt[]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  }
  async drag(from: Pt, to: Pt, steps = 20) {
    await this.send('touchStart', [from]);
    for (let i = 1; i <= steps; i++) {
      await this.send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    }
    await this.send('touchEnd', []);
  }
  async tap(p: Pt) {
    await this.send('touchStart', [p]);
    await this.send('touchEnd', []);
  }
  async pinch(c: Pt, from: number, to: number, steps = 15) {
    await this.send('touchStart', [{ x: c.x - from, y: c.y }, { x: c.x + from, y: c.y }]);
    for (let i = 1; i <= steps; i++) {
      const d = from + ((to - from) * i) / steps;
      await this.send('touchMove', [{ x: c.x - d, y: c.y }, { x: c.x + d, y: c.y }]);
    }
    await this.send('touchEnd', []);
  }
}

/** Counts Konva's hit-canvas shape draws, and the longest frame, from now. */
async function watch(page: Page) {
  await page.evaluate(() => {
    type W = { Konva: { Shape: { prototype: { drawHit: (...a: unknown[]) => unknown } } }; __watch?: { hits: number; longest: number; on: boolean } };
    const w = window as unknown as W;
    const me = { hits: 0, longest: 0, on: true };
    w.__watch = me;
    const proto = w.Konva.Shape.prototype as { drawHit: (...a: unknown[]) => unknown; __real?: (...a: unknown[]) => unknown };
    proto.__real ??= proto.drawHit;
    const real = proto.__real;
    proto.drawHit = function (this: unknown, ...a: unknown[]) {
      if (me.on) me.hits++;
      return real.apply(this, a);
    };
    let last = performance.now();
    const tick = (t: number) => {
      if (!me.on) return;
      me.longest = Math.max(me.longest, t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/** How many shapes one full hit-canvas draw draws. */
async function oneHitDraw(page: Page): Promise<number> {
  await watch(page);
  await page.evaluate(() => {
    const st = (window as unknown as { Konva: { stages: { getLayers: () => { isListening: () => boolean; drawHit: () => void }[] }[] } }).Konva.stages[0]!;
    for (const l of st.getLayers()) if (l.isListening()) l.drawHit();
  });
  return (await stopWatch(page, 'one hit draw', 0)).hits;
}

async function stopWatch(page: Page, label: string, ms: number) {
  const r = await page.evaluate(() => {
    const w = (window as unknown as { __watch: { hits: number; longest: number; on: boolean } }).__watch;
    w.on = false;
    return { hits: w.hits, longest: Math.round(w.longest) };
  });
  if (process.env.PERF_LOG) console.log('PERF', label, JSON.stringify({ ms, ...r }));
  return r;
}

/** The screen point of a part near the view's centre, big enough to tap. */
function partNearCentre(page: Page): Promise<(Pt & { id: string }) | null> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; getClientRect: () => { x: number; y: number; width: number; height: number } };
    const st = (window as unknown as { Konva: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva.stages[0]!;
    const b = st.container().getBoundingClientRect();
    let best: { x: number; y: number; id: string; d: number } | null = null;
    for (const n of st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))) {
      const r = n.getClientRect();
      if (r.width < 6 || r.height < 6) continue;
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      if (x < 30 || y < 30 || x > b.width - 30 || y > b.height - 30) continue;
      const d = Math.hypot(x - b.width / 2, y - b.height / 2);
      if (!best || d < best.d) best = { x: b.left + x, y: b.top + y, id: n.name().slice(6), d };
    }
    return best;
  });
}

test('Fordyce on a slow phone: opens, pans, pinches, drags, picks all and opens Sheets in time', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU throttling and touch through CDP');
  test.setTimeout(240_000);
  await signIn(page, `phone-perf-${Date.now()}@example.com`, 'Phone Perf');
  const res = await page.request.post('/api/layouts', { data: { title: 'Fordyce 2026', bbm: FORDYCE_BBM } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const finger = new Finger(cdp);

  // Opens: the map, then every part picture.
  let t = Date.now();
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('loading-card')).toBeHidden({ timeout: 60000 });
  const openMs = Date.now() - t;
  if (process.env.PERF_LOG) console.log('PERF open', openMs);
  expect(openMs).toBeLessThan(45000);
  await expect(page.getByText('940 pieces')).toBeVisible();

  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  await page.getByRole('button', { name: 'Fit', exact: true }).tap();
  const box = (await page.locator('.konvajs-content').first().boundingBox())!;
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Pan with one finger, then pinch: no hit drawing while the fingers move,
  // just once when they let go.
  await page.waitForTimeout(500);
  const once = await oneHitDraw(page);
  expect(once).toBeGreaterThan(900);
  await watch(page);
  t = Date.now();
  await finger.drag({ x: c.x - 100, y: c.y + 120 }, { x: c.x + 60, y: c.y + 180 });
  const pan = await stopWatch(page, 'pan', Date.now() - t);
  expect(pan.hits).toBeLessThanOrEqual(1.5 * once);
  expect(pan.longest).toBeLessThan(1000);

  await page.waitForTimeout(300);
  await watch(page);
  t = Date.now();
  await finger.pinch({ x: c.x, y: c.y + 150 }, 30, 110);
  const pinch = await stopWatch(page, 'pinch', Date.now() - t);
  expect(pinch.hits).toBeLessThanOrEqual(1.5 * once);
  expect(pinch.longest).toBeLessThan(1000);

  // Right after: a tap picks the part under it (the hit canvas is up to date).
  await page.getByRole('button', { name: 'Fit', exact: true }).tap();
  await page.waitForTimeout(500);
  const part = await partNearCentre(page);
  expect(part).not.toBeNull();
  await finger.tap(part!);
  await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', '1 picked', { timeout: 10000 });

  // Drag the picked part.
  await watch(page);
  t = Date.now();
  await finger.drag(part!, { x: part!.x + 50, y: part!.y + 30 });
  const drag = await stopWatch(page, 'drag', Date.now() - t);
  expect(drag.longest).toBeLessThan(1000);
  await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', '1 picked');

  // Pick everything (a keyboard on the phone), then open Sheets.
  t = Date.now();
  await page.keyboard.press('Control+a');
  await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', /^9\d\d picked$/, { timeout: 10000 });
  const allMs = Date.now() - t;
  if (process.env.PERF_LOG) console.log('PERF select-all', allMs);
  expect(allMs).toBeLessThan(8000);

  t = Date.now();
  await page.getByTestId('editor-header').getByRole('button', { name: /Fordyce 2026/ }).tap();
  await page.getByTestId('phone-sheets').tap();
  await expect(page.getByRole('dialog', { name: 'Sheets' })).toBeVisible({ timeout: 10000 });
  const sheetsMs = Date.now() - t;
  if (process.env.PERF_LOG) console.log('PERF sheets', sheetsMs);
  expect(sheetsMs).toBeLessThan(8000);
});
