// A finger like a real one, on a phone with a slow CPU: uneven event
// gaps (8-40 ms), the same position sent again (Chrome repeats a touchmove
// when only the pressure changes), small jitter, pauses and bursts. Near a
// free end the snap must take hold once and never let go and take again
// (flicker) while the finger stays close. The snap trace (snapTrace.ts)
// records every frame; a failure prints it.

import { test, expect, devices, type Page, type CDPSession } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const { defaultBrowserType: _p, ...pixel7 } = devices['Pixel 7'];

const FORDYCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);
const CURVE = '2867.8';
const C0 = { x: -8.1875, y: -1.375 };
const C1 = { x: 7.1198, y: 1.6698 };
const ts = Date.now();
let seq = 0;

const rot = (p: { x: number; y: number }, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};

/** B (turned 22.5) joined to A; C's free end `gap` studs right of B's free end, `turn` degrees off. */
function scene(gap: number, turn: number) {
  const a = { x: 100, y: 60, o: 0 };
  const aEnd = rot(C1, 0);
  const bOff = rot(C0, 22.5);
  const b = { x: a.x + aEnd.x - bOff.x, y: a.y + aEnd.y - bOff.y, o: 22.5 };
  const bFree = rot(C1, 22.5);
  const p = { x: b.x + bFree.x + gap, y: b.y + bFree.y };
  const oc = turn - 135 - 180;
  const cOff = rot(C0, oc);
  return { a, b, c: { x: p.x - cOff.x, y: p.y - cOff.y, o: oc }, p };
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
  return FORDYCE.replace(/<Layer type="(brick|ruler|text)"[\s\S]*?<\/Layer>/g, '').replace(/(<Layers[^>]*>)/, `$1${layer}`);
}

interface Shown {
  rot: number;
  sx: number;
  sy: number;
}

function shown(page: Page): Promise<Shown[]> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; rotation: () => number; getAbsolutePosition: () => { x: number; y: number } };
    const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return [];
    const box = st.container().getBoundingClientRect();
    return st
      .find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))
      .map((n) => {
        const a = n.getAbsolutePosition();
        return { rot: n.rotation(), sx: box.left + a.x, sy: box.top + a.y };
      });
  });
}
const byTurn = (all: Shown[], o: number) => all.find((b) => Math.abs((((b.rot - o) % 360) + 360) % 360) < 0.01);
const zoom = (page: Page) =>
  page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());

interface Frame {
  t: number;
  decision: string;
  target: string | null;
  dist: number | null;
  rawX: number;
  rawY: number;
  speed: number;
  fast: boolean;
  reach: number;
  hold: number;
}
const traceOf = (page: Page) => page.evaluate(() => (window as unknown as { __cldSnapTrace: () => unknown[] }).__cldSnapTrace() as Frame[]);

/** A seeded wobble, so a failure replays the same. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

async function fingerReplay(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, seed: number) {
  let force = 0.5;
  const touch = (type: string, x: number, y: number) => {
    // A finger's pressure keeps changing: Chrome sends a touchmove for that
    // even when the position doesn't.
    force = force > 0.6 ? 0.4 : force + 0.05;
    return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 0, force }] });
  };
  // Android Chrome sends a touchmove when only the finger's pressure or
  // size changes, at the very same point. CDP drops those, so send one as
  // the page would get it.
  const samePoint = (x: number, y: number) =>
    page.evaluate(
      ([cx, cy]) => {
        const target = document.querySelector('.konvajs-content canvas') ?? document.body;
        const t = new Touch({ identifier: 0, target, clientX: cx!, clientY: cy!, force: 0.7 });
        target.dispatchEvent(new TouchEvent('touchmove', { touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true }));
      },
      [x, y],
    );
  const r = rng(seed);
  const gap = () => 8 + Math.floor(r() * 33); // 8-40 ms between events
  await touch('touchStart', from.x, from.y);
  // The approach, unevenly, with the same point sent again now and then.
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps + (r() - 0.5) * 2;
    const y = from.y + ((to.y - from.y) * i) / steps + (r() - 0.5) * 2;
    await touch('touchMove', x, y);
    if (i % 3 === 0) await samePoint(x, y); // pressure only
    if (i % 11 === 0) {
      // A burst: coalesced events handled together.
      await touch('touchMove', x + 1, y);
      await touch('touchMove', x + 2, y - 1);
    } else await page.waitForTimeout(gap());
  }
  // Hovering near the end: 1-3 px jitter, repeats, pauses.
  for (let i = 0; i < 60; i++) {
    const x = to.x + (r() - 0.5) * 6;
    const y = to.y + (r() - 0.5) * 6;
    await touch('touchMove', x, y);
    if (r() < 0.4) await samePoint(x, y);
    await page.waitForTimeout(i % 15 === 14 ? 220 : gap());
  }
  await touch('touchEnd', to.x, to.y);
}

for (const turn of [0, 45, 135]) {
  test.describe(`a finger near a free end ${turn} degrees off`, () => {
    test.use(pixel7);
    test('snaps once and never flickers off and on while the finger stays close', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
      test.slow(); // a slowed CPU
      await page.addInitScript(() => localStorage.setItem('cld:snapTrace', '1'));
      await signIn(page, `snapreplay-${turn}-${ts}-${seq++}@example.com`, 'Shaky Finger');
      const gapStuds = turn > 90 ? 20 : 6;
      const s = scene(gapStuds, turn);
      const res = await page.request.post('/api/layouts', { data: { title: 'Replay', bbm: bbmWith([s.a, s.b, s.c]) } });
      expect(res.ok()).toBe(true);
      const { id } = (await res.json()) as { id: string };
      await page.goto(`/editor/${id}`);
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
      await expect.poll(() => shown(page).then((b) => b.length)).toBe(3);
      const cdp = await page.context().newCDPSession(page);
      await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
      // Zoomed in as on a phone in the hand (a two-finger spread).
      const two = (type: string, d: number, c: { x: number; y: number }) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: c.x - d, y: c.y, id: 0 }, { x: c.x + d, y: c.y, id: 1 }],
        });
      for (let k = 0; k < 4 && 8 * (await zoom(page)) < 12; k++) {
        const c0 = byTurn(await shown(page), 22.5)!;
        await two('touchStart', 20, { x: c0.sx, y: c0.sy });
        for (let d = 25; d <= 45; d += 5) await two('touchMove', d, { x: c0.sx, y: c0.sy });
        await two('touchEnd', 0, { x: c0.sx, y: c0.sy });
        await page.waitForTimeout(150);
      }
      const b = byTurn(await shown(page), 22.5)!;
      // Pick B with a tap, then a slow CPU for the drag.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.sx, y: b.sy, id: 0 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', '1 picked');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const px = 8 * (await zoom(page));
      // B's free end ends 0.3 studs short of C's.
      const dx = (gapStuds - 0.3) * px;
      await fingerReplay(page, cdp, { x: b.sx, y: b.sy }, { x: b.sx + dx, y: b.sy }, 7 + turn);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      const frames = await traceOf(page);
      // From the first time it takes hold of the end it drops on, it never
      // lets go (passing other ends on the way may snap and unsnap).
      const end = frames.at(-1)!.target;
      const first = frames.findIndex((f) => f.target !== null && f.target === end);
      const flickers = frames.slice(first + 1).filter((f) => f.decision === 'release').length;
      if (first < 0 || flickers > 0 || process.env.SNAP_TRACE_LOG) {
        console.log(JSON.stringify(frames.map((f) => [f.t, f.decision, f.target, f.dist?.toFixed(2), f.rawX.toFixed(2), f.rawY.toFixed(2), f.speed, f.fast, f.reach.toFixed(2)])));
      }
      expect(first, 'it snaps at all').toBeGreaterThanOrEqual(0);
      expect(flickers, 'no release while the finger stays close').toBe(0);
      expect(frames.at(-1)!.decision).toBe('drop');
      expect(frames.at(-1)!.target).not.toBeNull();
    });
  });
}
