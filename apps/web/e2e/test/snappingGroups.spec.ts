// A joined group of curves snaps onto a free end at an angle by turning as
// a whole (editor/snapFeel.ts group turn), by mouse and by touch: the
// group lands joined and facing, and stays joined inside.
//
// Touches are sent through CDP (Input.dispatchTouchEvent), so the touch
// test runs in Chromium with a phone's touch screen.

import { test, expect, devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];

const FORDYCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);
const CURVE = '2867.8'; // 9V curve: 22.5 degrees of an R40 circle
const C0 = { x: -8.1875, y: -1.375, angle: 180 };
const C1 = { x: 7.1198, y: 1.6698, angle: 22.5 };
const ts = Date.now();
let seq = 0;

const rot = (p: { x: number; y: number }, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

/**
 * A (turned 0) joined to B (turned 22.5): B's free end faces 45 degrees.
 * C's free first end sits `gap` studs right of it and faces -90 degrees,
 * so the group must turn 45 degrees to join it.
 */
function scene(gap: number) {
  const a = { x: 100, y: 60, o: 0 };
  const aEnd = rot(C1, 0);
  const bOff = rot(C0, 22.5);
  const b = { x: a.x + aEnd.x - bOff.x, y: a.y + aEnd.y - bOff.y, o: 22.5 };
  const bFree = rot(C1, 22.5);
  const p = { x: b.x + bFree.x + gap, y: b.y + bFree.y };
  const oc = 90; // C0 faces 180 + 90 = 270 = -90
  const cOff = rot(C0, oc);
  const c = { x: p.x - cOff.x, y: p.y - cOff.y, o: oc };
  return { a, b, c, p };
}

function bbmWith(bricks: { x: number; y: number; o: number }[]): string {
  const xml = bricks
    .map(
      (b, i) => `<Brick id="${900 + i}"><DisplayArea><X>${b.x - 8}</X><Y>${b.y - 4}</Y><Width>16</Width><Height>8</Height></DisplayArea>` +
        `<MyGroup /><PartNumber>${CURVE}</PartNumber><Orientation>${b.o}</Orientation>` +
        '<ActiveConnectionPointIndex>0</ActiveConnectionPointIndex><Altitude>0</Altitude><Connexions count="0" /></Brick>',
    )
    .join('');
  const first = /<Layer type="brick"[\s\S]*?<\/Layer>/.exec(FORDYCE)![0];
  const layer = first.replace(/<Bricks>[\s\S]*<\/Bricks>/, `<Bricks>${xml}</Bricks>`);
  return FORDYCE.replace(/<Layer type="(brick|ruler|text)"[\s\S]*?<\/Layer>/g, '').replace(
    /(<Layers[^>]*>)/,
    `$1${layer}`,
  );
}

interface Shown {
  id: string;
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

function shown(page: Page): Promise<Shown[]> {
  return page.evaluate(() => {
    type N = {
      name: () => string;
      getClassName: () => string;
      x: () => number;
      y: () => number;
      rotation: () => number;
      getAbsolutePosition: () => { x: number; y: number };
    };
    const st = (window as unknown as {
      Konva?: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] };
    }).Konva?.stages[0];
    if (!st) return [];
    const box = st.container().getBoundingClientRect();
    return st
      .find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))
      .map((n) => {
        const a = n.getAbsolutePosition();
        return { id: n.name().slice(6), x: n.x() / 8, y: n.y() / 8, rot: n.rotation(), sx: box.left + a.x, sy: box.top + a.y };
      });
  });
}

const zoom = (page: Page) =>
  page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());

const byTurn = (all: Shown[], o: number) => all.find((b) => Math.abs((((b.rot - o) % 360) + 360) % 360) < 0.01);

async function open(page: Page, who: string, gap: number) {
  await signIn(page, `snapgroup-${who}-${ts}-${seq++}@example.com`, 'Group Snapper');
  const s = scene(gap);
  const res = await page.request.post('/api/layouts', { data: { title: 'Group snap', bbm: bbmWith([s.a, s.b, s.c]) } });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => shown(page).then((b) => b.length)).toBe(3);
  return s;
}

/** The group landed turned 45 degrees, joined to C, and A and B still joined. */
async function expectJoined(page: Page, s: ReturnType<typeof scene>) {
  await expect.poll(async () => byTurn(await shown(page), 45) !== undefined, { timeout: 5000 }).toBe(true);
  const all = await shown(page);
  const a = byTurn(all, 45)!;
  const b = byTurn(all, 67.5)!;
  expect(b).toBeDefined();
  // B's free end is on C's free end.
  const bEnd = rot(C1, 67.5);
  expect(b.x + bEnd.x).toBeCloseTo(s.p.x, 1);
  expect(b.y + bEnd.y).toBeCloseTo(s.p.y, 1);
  // A's end still meets B's.
  const aEnd = rot(C1, 45);
  const bStart = rot(C0, 67.5);
  expect(a.x + aEnd.x).toBeCloseTo(b.x + bStart.x, 1);
  expect(a.y + aEnd.y).toBeCloseTo(b.y + bStart.y, 1);
}

test.describe('a group of curves snaps at an angle', () => {
  test('by mouse: two picked curves turn as one onto a free end 45 degrees off', async ({ page }) => {
    const s = await open(page, 'mouse', 6);
    const all = await shown(page);
    const a = byTurn(all, 0)!;
    const b = byTurn(all, 22.5)!;
    await page.mouse.click(a.sx, a.sy);
    await page.keyboard.down('Shift');
    await page.mouse.click(b.sx, b.sy);
    await page.keyboard.up('Shift');
    await expect(page.locator('footer')).toContainText('selected: 2');
    const px = 8 * (await zoom(page));
    // Slowly, so the snap is live; B's free end ends 0.4 studs short of C's.
    const dx = (6 - 0.4) * px;
    await page.mouse.move(a.sx, a.sy);
    await page.mouse.down();
    const steps = Math.max(8, Math.ceil(dx / 4));
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.sx + (dx * i) / steps, a.sy);
      await page.waitForTimeout(16);
    }
    // The live preview already shows the group turned.
    await expect.poll(async () => byTurn(await shown(page), 45) !== undefined).toBe(true);
    await page.mouse.up();
    await expectJoined(page, s);
  });

  test.describe('by touch', () => {
    test.use(pixel7);
    test('two picked curves dragged by a finger turn as one onto a free end 45 degrees off', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
      const s = await open(page, 'touch', 6);
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: string, pts: { x: number; y: number }[]) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
      await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
      const bar = page.getByTestId('touch-bar');
      // Tap one, long-press the other to pick it too.
      let all = await shown(page);
      const a0 = byTurn(all, 0)!;
      const b0 = byTurn(all, 22.5)!;
      await touch('touchStart', [{ x: a0.sx, y: a0.sy }]);
      await touch('touchEnd', []);
      await expect(bar).toHaveAttribute('aria-label', '1 picked');
      await touch('touchStart', [{ x: b0.sx, y: b0.sy }]);
      await page.waitForTimeout(800);
      await touch('touchEnd', []);
      await expect(bar).toHaveAttribute('aria-label', '2 picked');
      all = await shown(page);
      const a = byTurn(all, 0)!;
      const px = 8 * (await zoom(page));
      const dx = (6 - 0.4) * px;
      await touch('touchStart', [{ x: a.sx, y: a.sy }]);
      const steps = Math.max(8, Math.ceil(dx / 4));
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ x: a.sx + (dx * i) / steps, y: a.sy }]);
        await page.waitForTimeout(16);
      }
      await expect.poll(async () => byTurn(await shown(page), 45) !== undefined).toBe(true);
      await touch('touchEnd', []);
      await expectJoined(page, s);
    });
  });
});
