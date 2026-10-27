// Journey — copy parts from one layout to another, on a phone.
//
//   On a Pixel 7, editing layout A: add a part, Duplicate it, pick both →
//   the touch bar's More actions ▸ Copy → open layout B → the bar's Paste
//   puts both in the middle of the view, picked → the server has them.
//   The copy is in the system clipboard in the same format as Ctrl+C, so a
//   computer's browser pastes it with Ctrl+V, and a phone pastes what a
//   computer copied.
//
//   When the browser won't let the app use the system clipboard, the copy
//   stays in the tab: it says so in plain words, and it still pastes in
//   layout B, at the spot of a long press (Paste here). Cut works the same
//   way.
//
// Phones had only Duplicate before, so nothing could be copied between
// layouts by touch.

import { test, expect, devices, type Browser, type CDPSession, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
const PART = 'ts_narrowgauge_straight.8';
const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

// A person's taps are well over the editor's 200 ms undo grouping apart.
const human = (page: Page) => page.waitForTimeout(400);

/** Each part's centre on the page. */
function parts(page: Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; getClientRect: () => { x: number; y: number; width: number; height: number } };
    const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return [];
    const box = st.container().getBoundingClientRect();
    return st
      .find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))
      .map((n) => {
        const r = n.getClientRect();
        return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2 };
      });
  });
}

/** How many parts the server has in the layout. */
async function serverParts(page: Page, id: string): Promise<number> {
  const r = await page.request.get(`/api/layouts/${id}/export.bbm`);
  return ((await r.text()).match(/<Brick id=/g) ?? []).length;
}

async function newLayout(page: Page, title: string): Promise<string> {
  const res = await page.request.post('/api/layouts', { data: { title } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function openToEdit(page: Page, id: string): Promise<void> {
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
}

/** Adds two parts by touch and leaves both picked. */
async function twoPartsPicked(page: Page): Promise<void> {
  const bar = page.getByTestId('touch-bar');
  await page.getByTestId('add-part').tap();
  const sheet = page.getByRole('dialog', { name: 'Add a part' });
  await sheet.getByRole('searchbox', { name: 'Search parts' }).fill('narrow gauge track straight 4 x 16');
  await sheet.locator(`[data-part-key="${PART}"]`).first().tap();
  await expect(sheet).toHaveCount(0);
  await human(page);
  await bar.getByRole('button', { name: 'Duplicate' }).tap();
  await expect.poll(async () => (await parts(page)).length).toBe(2);
  await bar.getByRole('button', { name: 'Select more' }).tap();
  const [first] = await parts(page);
  await page.touchscreen.tap(first!.x, first!.y);
  await expect(bar).toHaveAttribute('aria-label', '2 picked');
}

async function moreActions(page: Page, action: string): Promise<void> {
  await page.getByTestId('touch-bar').getByRole('button', { name: 'More actions' }).tap();
  const more = page.getByRole('dialog', { name: 'More actions' });
  await more.getByRole('button', { name: action, exact: true }).tap();
  await expect(more).toHaveCount(0);
}

/** A computer's browser, signed in as the same person. */
async function desktop(browser: Browser, page: Page): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, storageState: await page.context().storageState() });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  return ctx.newPage();
}

test('copy two parts on a phone, open another layout, paste them, and a computer pastes the same copy', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch and the clipboard through Chromium');
  test.setTimeout(240_000);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, `j-phone-clip-${ts}@example.com`, 'Phone Clipboard');
  const a = await newLayout(page, 'Layout A');
  const b = await newLayout(page, 'Layout B');
  const bar = page.getByTestId('touch-bar');

  // ── Layout A: two parts picked, More actions ▸ Copy. ──
  await openToEdit(page, a);
  await twoPartsPicked(page);
  await moreActions(page, 'Copy');
  await expect(page.getByText('Copied 2 parts. To place them, tap Paste, in this layout or another.')).toBeVisible();
  // In the system clipboard, in the same format as Ctrl+C on a computer.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toMatchObject({ kind: 'cbld-bricks/v1', version: 1, entries: [{ brick: { partNumber: PART } }, { brick: { partNumber: PART } }] });

  // ── Layout B: the bar's Paste, in the middle of the view. ──
  await openToEdit(page, b);
  await expect.poll(async () => (await parts(page)).length).toBe(0);
  await bar.getByRole('button', { name: 'Paste' }).tap();
  await expect(page.getByText('Pasted 2 parts.')).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', '2 picked');
  const pasted = await parts(page);
  expect(pasted).toHaveLength(2);
  const map = (await page.getByTestId('canvas-area').boundingBox())!;
  const mid = { x: (pasted[0]!.x + pasted[1]!.x) / 2, y: (pasted[0]!.y + pasted[1]!.y) / 2 };
  expect(Math.abs(mid.x - (map.x + map.width / 2)), 'in the middle of the view').toBeLessThan(40);
  expect(Math.abs(mid.y - (map.y + map.height / 2))).toBeLessThan(40);
  await expect.poll(() => serverParts(page, b), { timeout: 15000 }).toBe(2);
  await expect.poll(() => serverParts(page, a)).toBe(2);

  // ── A computer pastes the phone's copy with Ctrl+V… ──
  const pc = await desktop(browser, page);
  const c = await newLayout(pc, 'Layout C');
  await pc.goto(`/editor/${c}`);
  await expect(pc.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  // (The phone's clipboard reaching the computer: a shared clipboard, or the person pasting it across.)
  await pc.evaluate((t) => navigator.clipboard.writeText(t), copied);
  const area = (await pc.locator('.konvajs-content').first().boundingBox())!;
  await pc.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await pc.keyboard.press('Control+v');
  await expect.poll(() => serverParts(pc, c), { timeout: 15000 }).toBe(2);

  // ── …and the phone pastes what the computer copied with Ctrl+C. ──
  // (The pasted parts are picked on the computer.)
  await pc.keyboard.press('Control+c');
  await expect.poll(async () => JSON.parse(await pc.evaluate(() => navigator.clipboard.readText())).copiedAt ?? 0).toBeGreaterThan(JSON.parse(copied).copiedAt);
  const fromPc = await pc.evaluate(() => navigator.clipboard.readText());
  await pc.context().close();
  await page.evaluate((t) => navigator.clipboard.writeText(t), fromPc);
  await bar.getByRole('button', { name: 'Done' }).tap();
  await human(page);
  await bar.getByRole('button', { name: 'Paste' }).tap();
  await expect(page.getByText('Pasted 2 parts.')).toBeVisible();
  await expect.poll(() => serverParts(page, b), { timeout: 15000 }).toBe(4);
});

class Finger {
  constructor(private cdp: CDPSession) {}
  static async on(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }
  private send(type: string, pts: { x: number; y: number }[]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  }
  async longPress(p: { x: number; y: number }, page: Page) {
    await this.send('touchStart', [p]);
    await page.waitForTimeout(800);
    await this.send('touchEnd', []);
  }
}

test('with the system clipboard blocked, Cut keeps the copy in the tab, says so, and Paste here puts it at a long press', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch through Chromium');
  test.setTimeout(180_000);
  // A browser that won't let pages use the clipboard.
  await page.addInitScript(() => {
    const no = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: no, writeText: no } });
  });
  await signIn(page, `j-phone-clip-blocked-${ts}@example.com`, 'Phone Clipboard');
  const a = await newLayout(page, 'Layout A');
  const b = await newLayout(page, 'Layout B');
  const bar = page.getByTestId('touch-bar');

  // ── Nothing copied yet: Paste says how to copy. ──
  await openToEdit(page, b);
  // With nothing picked the bar has Paste, and every button fits the screen.
  const right = await bar.getByRole('button').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
  expect(right).toBeLessThanOrEqual(page.viewportSize()!.width);
  await bar.getByRole('button', { name: 'Paste' }).tap();
  await expect(page.getByText(/Nothing to paste yet\. Your browser didn’t let the app read the clipboard/)).toBeVisible();

  // ── Layout A: Cut two parts. ──
  await openToEdit(page, a);
  await twoPartsPicked(page);
  await moreActions(page, 'Cut');
  await expect(page.getByText('Cut 2 parts. Your browser keeps the copy in this tab only, so paste it in this tab, in this layout or another.')).toBeVisible();
  await expect.poll(async () => (await parts(page)).length).toBe(0);
  await expect.poll(() => serverParts(page, a), { timeout: 15000 }).toBe(0);

  // ── Layout B, in the same tab: a long press on empty map ▸ Paste here. ──
  await openToEdit(page, b);
  const map = (await page.getByTestId('canvas-area').boundingBox())!;
  const spot = { x: map.x + map.width * 0.3, y: map.y + map.height * 0.6 };
  const finger = await Finger.on(page);
  await finger.longPress(spot, page);
  const here = page.getByRole('dialog', { name: 'Paste here' });
  await expect(here).toBeVisible();
  // Fits the phone, above the finger.
  const box = (await here.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(spot.y);
  await here.getByRole('button', { name: 'Paste here' }).tap();
  await expect(here).toHaveCount(0);
  await expect(page.getByText('Pasted 2 parts.')).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', '2 picked');
  const pasted = await parts(page);
  expect(pasted).toHaveLength(2);
  const mid = { x: (pasted[0]!.x + pasted[1]!.x) / 2, y: (pasted[0]!.y + pasted[1]!.y) / 2 };
  expect(Math.abs(mid.x - spot.x), 'centred on the long press').toBeLessThan(40);
  expect(Math.abs(mid.y - spot.y)).toBeLessThan(40);
  await expect.poll(() => serverParts(page, b), { timeout: 15000 }).toBe(2);

  // ── A long press, then a tap elsewhere: Paste here goes away. ──
  await bar.getByRole('button', { name: 'Done' }).tap();
  await finger.longPress({ x: map.x + map.width * 0.7, y: map.y + map.height * 0.25 }, page);
  await expect(here).toBeVisible();
  await page.touchscreen.tap(map.x + map.width * 0.6, map.y + map.height * 0.42);
  await expect(here).toHaveCount(0);
});
