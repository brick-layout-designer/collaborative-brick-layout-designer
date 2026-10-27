// Journey — measure and paint areas by touch, on a phone and a tablet.
//
//   The touch bar's Tools ▸ Measure a distance → tap the start, tap the end
//   → the ruler is picked with round handles → a finger drags one end →
//   Done. Measure a circle: tap the middle, tap its edge. Paint areas: one
//   finger paints the squares it passes over, two fingers still zoom the
//   map without painting, Erase takes the color off, Done ends it. The
//   server has each step. On the tablet, the toolbar's Measure button
//   starts the same tap, tap.
//
// There was no way to measure or paint by touch before: a finger only
// moved the map with those tools.

import { test, expect, devices, type CDPSession, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
let seq = 0;
const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];
const { defaultBrowserType: _t, ...iPad } = devices['iPad (gen 7)'];

type Pt = { x: number; y: number };

class Finger {
  constructor(private cdp: CDPSession) {}
  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }
  private send(type: string, pts: Pt[]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  }
  async tap(p: Pt) {
    await this.send('touchStart', [p]);
    await this.send('touchEnd', []);
  }
  async drag(from: Pt, to: Pt, steps = 16) {
    await this.send('touchStart', [from]);
    for (let i = 1; i <= steps; i++) {
      await this.send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    }
    await this.send('touchEnd', []);
  }
  async pinchOut(c: Pt) {
    await this.send('touchStart', [{ x: c.x - 20, y: c.y }, { x: c.x + 20, y: c.y }]);
    for (let d = 30; d <= 90; d += 10) await this.send('touchMove', [{ x: c.x - d, y: c.y }, { x: c.x + d, y: c.y }]);
    await this.send('touchEnd', []);
  }
}

async function bbm(page: Page, id: string): Promise<string> {
  return (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
}
const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const point2 = (xml: string) => {
  const m = xml.match(/<Point2>\s*<X>([-\d.]+)<\/X>\s*<Y>([-\d.]+)<\/Y>/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};

/** The screen centre of the picked ruler's second end handle. */
function endHandle(page: Page): Promise<Pt | null> {
  return page.evaluate(() => {
    type N = { getClientRect: () => { x: number; y: number; width: number; height: number } };
    const st = (window as unknown as { Konva: { stages: { container: () => HTMLElement; find: (s: string) => N[] }[] } }).Konva.stages[0]!;
    const box = st.container().getBoundingClientRect();
    const h = st.find('.ruler-endpoint')[1];
    if (!h) return null;
    const r = h.getClientRect();
    return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
  });
}

const stageScale = (page: Page) =>
  page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());

async function openTool(page: Page, name: string): Promise<void> {
  await page.getByTestId('touch-bar').getByRole('button', { name: 'Measure and paint' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Measure and paint' });
  await expect(sheet).toBeVisible();
  // (It slides up.)
  await page.waitForTimeout(300);
  await sheet.getByRole('button', { name: new RegExp(`^${name}`) }).tap();
  await expect(sheet).toHaveCount(0);
}

async function journey(page: Page, device: 'phone' | 'tablet'): Promise<void> {
  await signIn(page, `j-touch-measure-${device}-${ts}-${seq++}@example.com`, 'Touch Measure');
  const res = await page.request.post('/api/layouts', { data: { title: `Measure ${device}` } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  if (device === 'phone') await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  const finger = await Finger.on(page);
  const map = (await page.getByTestId('canvas-area').boundingBox())!;
  const at = (fx: number, fy: number): Pt => ({ x: map.x + map.width * fx, y: map.y + map.height * fy });
  const draw = page.getByTestId('touch-draw-bar');
  const bar = page.getByTestId('touch-bar');

  // ── A ruler: tap the start, tap the end. ──
  await openTool(page, 'Measure a distance');
  await expect(draw).toContainText('Tap where the ruler starts.');
  await finger.tap(at(0.25, 0.4));
  await expect(draw).toContainText('Now tap where the ruler ends.');
  await expect.poll(() => page.evaluate(() => (window as unknown as { Konva: { stages: { find: (s: string) => unknown[] }[] } }).Konva.stages[0]!.find('.touch-ruler-start').length)).toBe(1);
  await finger.tap(at(0.7, 0.4));
  await expect(draw).toHaveCount(0);
  await expect(bar).toHaveAttribute('aria-label', '1 picked');
  await expect(bar).toContainText('Drag the round handles to adjust the ruler.');
  await expect.poll(async () => count(await bbm(page, id), /<LinearRuler>/g), { timeout: 15000 }).toBe(1);
  const before = point2(await bbm(page, id))!;

  // ── A finger drags its end. ──
  const handle = (await endHandle(page))!;
  expect(handle).not.toBeNull();
  await finger.drag(handle, { x: handle.x, y: handle.y + map.height * 0.2 });
  await expect.poll(async () => point2(await bbm(page, id))?.y ?? before.y, { timeout: 15000 }).toBeGreaterThan(before.y + 1);
  await bar.getByRole('button', { name: 'Done' }).tap();
  await expect(bar).toHaveAttribute('aria-label', 'Touch editing');

  // ── A circle: its middle, then its edge. ──
  if (device === 'tablet') {
    // The toolbar's Measure ▸ circle starts the same tap, tap.
    await page.getByRole('button', { name: /^Circle/ }).first().tap();
  } else {
    await openTool(page, 'Measure a circle');
  }
  await expect(draw).toContainText('Tap the middle of the circle.');
  await finger.tap(at(0.5, 0.5));
  await expect(draw).toContainText('Now tap a point on the circle’s edge.');
  await finger.tap(at(0.5, 0.65));
  await expect(draw).toHaveCount(0);
  await expect.poll(async () => count(await bbm(page, id), /<CircularRuler>/g), { timeout: 15000 }).toBe(1);
  await bar.getByRole('button', { name: 'Done' }).tap();

  // ── Paint: one finger paints the squares it passes over. ──
  await openTool(page, 'Paint areas');
  await expect(draw).toContainText('Drag a finger to paint. Two fingers move the map.');
  await draw.getByRole('radio', { name: 'Blue' }).tap();
  await expect(draw.getByRole('radio', { name: 'Blue' })).toHaveAttribute('aria-checked', 'true');
  await finger.drag(at(0.2, 0.3), at(0.8, 0.3));
  // Every square along the stroke, side by side in one row.
  await expect.poll(async () => count(await bbm(page, id), /<Area>/g), { timeout: 15000 }).toBeGreaterThan(1);
  const row = await bbm(page, id);
  const cellStuds = Number(row.match(/<AreaCellSize>(\d+)<\/AreaCellSize>/)?.[1]);
  const xs = [...row.matchAll(/<Area>\s*<x>(-?\d+)<\/x>\s*<y>(-?\d+)<\/y>/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  const ys = new Set([...row.matchAll(/<Area>\s*<x>-?\d+<\/x>\s*<y>(-?\d+)<\/y>/g)].map((m) => m[1]));
  expect(ys.size, 'one row').toBe(1);
  expect(xs.at(-1)! - xs[0]! + 1, 'no gaps').toBe(xs.length);
  const k = await stageScale(page);
  expect(xs.length, 'as many as the stroke crosses').toBeGreaterThanOrEqual(Math.floor((map.width * 0.6) / (cellStuds * 8 * k)));
  expect(await bbm(page, id)).toContain('0060FF');

  // ── Erase takes it off again. ──
  await draw.getByRole('radio', { name: 'Erase' }).tap();
  await expect(draw).toContainText('Drag a finger to erase.');
  await finger.drag(at(0.15, 0.3), at(0.85, 0.3));
  await expect.poll(async () => count(await bbm(page, id), /<Area>/g), { timeout: 15000 }).toBe(0);

  // ── A tap paints one square; two fingers zoom the map and paint nothing. ──
  await draw.getByRole('radio', { name: 'Paint' }).tap();
  await finger.tap(at(0.5, 0.45));
  await expect.poll(async () => count(await bbm(page, id), /<Area>/g), { timeout: 15000 }).toBe(1);
  const scale = await stageScale(page);
  await finger.pinchOut(at(0.5, 0.6));
  await expect.poll(() => stageScale(page), { message: 'two fingers zoom the map' }).toBeGreaterThan(scale * 1.2);
  await page.waitForTimeout(800);
  expect(count(await bbm(page, id), /<Area>/g), 'and paint nothing').toBe(1);

  await draw.getByRole('button', { name: 'Done' }).tap();
  await expect(draw).toHaveCount(0);
  await expect(bar).toHaveAttribute('aria-label', 'Touch editing');
}

test.describe('measure and paint by touch on a phone', () => {
  test.use(pixel7);
  test('rulers by tap, tap, a dragged handle, a circle, and painting areas', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch through Chromium');
    test.setTimeout(180_000);
    await journey(page, 'phone');
  });
});

test.describe('measure and paint by touch on a tablet', () => {
  test.use(iPad);
  test('rulers by tap, tap, a dragged handle, a circle from the toolbar, and painting areas', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch through Chromium');
    test.setTimeout(180_000);
    await journey(page, 'tablet');
  });
});
