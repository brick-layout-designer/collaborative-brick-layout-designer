// E2E: the Venue Designer. Draw a room by typing its size, cut a door into
// it, add a floor outlet and a note, save it to the library, reopen it,
// then open the designer from a layout and save the venue there.

import { test, expect, devices, type CDPSession, type Page } from '@playwright/test';
import { ensureUser, signIn, mapMenu } from '../helpers';

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

  await mapMenu(page, 'Venue', 'Open venue designer…');
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

test.describe('by touch, on a tablet', () => {
  const { defaultBrowserType: _d, ...iPad } = devices['iPad (gen 7)'];
  test.use(iPad);

  async function fingers(page: Page) {
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const send = (type: string, pts: { x: number; y: number }[]) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
    return {
      async tap(p: { x: number; y: number }) {
        await send('touchStart', [p]);
        await send('touchEnd', []);
      },
      async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
        await send('touchStart', [from]);
        for (let i = 1; i <= 10; i++) await send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }]);
        await send('touchEnd', []);
      },
      async pinchOut(c: { x: number; y: number }) {
        await send('touchStart', [{ x: c.x - 30, y: c.y }, { x: c.x + 30, y: c.y }]);
        for (let d = 40; d <= 90; d += 10) await send('touchMove', [{ x: c.x - d, y: c.y }, { x: c.x + d, y: c.y }]);
        await send('touchEnd', []);
      },
    };
  }
  /** The corner handles on screen. */
  const handles = (page: Page) =>
    page.evaluate(() => {
      type N = { getClientRect: () => { x: number; y: number; width: number; height: number } };
      const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; find: (s: string) => N[] }[] } }).Konva?.stages[0];
      if (!st) return [];
      const box = st.container().getBoundingClientRect();
      return st.find('.venue-handle').map((n) => {
        const r = n.getClientRect();
        return { x: box.left + r.x + r.width / 2, y: box.top + r.y + r.height / 2, size: r.width };
      });
    });

  test('a finger draws, picks a wall, drags its corner with big handles, and two fingers zoom', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
    await signIn(page, EMAIL);
    await page.goto('/venues/new');
    await expect(page.getByRole('navigation', { name: 'Tools', exact: true })).toBeVisible();
    const f = await fingers(page);
    const box = (await page.getByTestId('venue-canvas').boundingBox())!;
    const A = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const B = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.5 };

    // Room: a finger on one corner, then the other.
    await page.keyboard.press('r');
    await f.tap(A);
    await f.tap(B);
    const size = page.getByText(/^Venue .+ × .+$/);
    await expect(size).toBeVisible();
    const before = (await size.textContent())!;

    // Select, then a tap on the top wall picks it: its corners get finger-sized handles.
    await page.keyboard.press('v');
    await f.tap({ x: (A.x + B.x) / 2, y: A.y + 3 });
    await expect.poll(async () => (await handles(page)).length).toBe(2);
    for (const h of await handles(page)) expect(h.size).toBeGreaterThanOrEqual(20);

    // A finger a little off the corner still takes it (beyond a mouse's reach), and drags it.
    const right = (await handles(page)).sort((p, q) => q.x - p.x)[0]!;
    await f.drag({ x: right.x - 12, y: right.y + 12 }, { x: right.x + 80, y: right.y });
    await expect(size).not.toHaveText(before);
    await expect.poll(async () => Math.round((await handles(page)).sort((p, q) => q.x - p.x)[0]!.x - right.x)).toBeGreaterThan(60);

    // Two fingers zoom in: the corners spread apart on screen.
    const spread = async () => {
      const hs = await handles(page);
      return Math.hypot(hs[0]!.x - hs[1]!.x, hs[0]!.y - hs[1]!.y);
    };
    const s0 = await spread();
    await f.pinchOut({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await expect.poll(spread).toBeGreaterThan(s0 * 1.5);
    // Nothing on the page itself zoomed.
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
  });
});
