// Bending flex track by touch on a phone (render/BendHandles.tsx): a tap
// picks a flex track set, bend handles sit on the run's free ends — and
// stay on them while the parts move, before anything is committed — and a
// finger dragging one bends the run until its end snaps and joins.
//
// Touches are sent through CDP (Input.dispatchTouchEvent), in Chromium
// with a phone's touch screen.

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
const ts = Date.now();
let seq = 0;

type Pt = { x: number; y: number };
const rot = (p: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) };
};
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });

// The flex track halves' connections, from the sprite centre (BlueBrickParts).
const FEMALE = { part: '88492.8', w: 3.25, rail: { x: -1.15, y: 0 }, pivot: { x: 0.85, y: 0 } };
const MALE = { part: '88493.8', w: 3.5, rail: { x: 1.25, y: 0 }, pivot: { x: -0.75, y: 0 } };

interface Placed {
  part: string;
  /** Box centre and size, studs. */
  cx: number;
  cy: number;
  w: number;
  o: number;
  group: string;
}

/** `sets` flex track sets in a row, joined end to end, the first from x0. */
function flexRow(sets: number, x0: number, y: number, name = 'run'): Placed[] {
  const out: Placed[] = [];
  for (let k = 0; k < sets; k++) {
    out.push({ part: FEMALE.part, cx: x0 + 4 * k - 0.8, cy: y, w: FEMALE.w, o: 0, group: `${name}${k}` });
    out.push({ part: MALE.part, cx: x0 + 4 * k + 0.8, cy: y, w: MALE.w, o: 0, group: `${name}${k}` });
  }
  return out;
}

/** One flex track set turned `o` degrees, its halves' box centres at `centres`. */
function turnedSet(centres: [Pt, Pt], o: number, name = 'loose'): Placed[] {
  return [
    { part: FEMALE.part, cx: centres[0].x, cy: centres[0].y, w: FEMALE.w, o, group: name },
    { part: MALE.part, cx: centres[1].x, cy: centres[1].y, w: MALE.w, o, group: name },
  ];
}

function bbmWith(bricks: Placed[]): string {
  const xml = bricks
    .map((b, i) => {
      // The box of a turned part: its footprint turned (8 studs tall).
      const r = (b.o * Math.PI) / 180;
      const w = Math.abs(b.w * Math.cos(r)) + Math.abs(8 * Math.sin(r));
      const h = Math.abs(b.w * Math.sin(r)) + Math.abs(8 * Math.cos(r));
      return (
        `<Brick id="${900 + i}"><DisplayArea><X>${b.cx - w / 2}</X><Y>${b.cy - h / 2}</Y><Width>${w}</Width><Height>${h}</Height></DisplayArea>` +
        `<MyGroup>${b.group}</MyGroup><PartNumber>${b.part}</PartNumber><Orientation>${b.o}</Orientation>` +
        '<ActiveConnectionPointIndex>0</ActiveConnectionPointIndex><Altitude>0</Altitude><Connexions count="0" /></Brick>'
      );
    })
    .join('');
  const groups = [...new Set(bricks.map((b) => b.group))]
    .map((g) => `<Group id="${g}"><PartNumber>FLEX.GROUP</PartNumber><MyGroup /></Group>`)
    .join('');
  const first = /<Layer type="brick"[\s\S]*?<\/Layer>/.exec(FORDYCE)![0];
  const layer = first
    .replace(/<Bricks>[\s\S]*<\/Bricks>/, `<Bricks>${xml}</Bricks>`)
    .replace(/<Groups>[\s\S]*?<\/Groups>|<Groups \/>/, `<Groups>${groups}</Groups>`);
  return FORDYCE.replace(/<Layer type="(brick|ruler|text)"[\s\S]*?<\/Layer>/g, '').replace(/(<Layers[^>]*>)/, `$1${layer}`);
}

interface Shown {
  id: string;
  /** Sprite centre (studs) and turn, as drawn now. */
  x: number;
  y: number;
  rot: number;
}

/** The bricks as drawn this frame (their Konva nodes), by id. */
async function shown(page: Page): Promise<Map<string, Shown>> {
  const list = await page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; x: () => number; y: () => number; rotation: () => number };
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return [];
    return st
      .find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-'))
      .map((n) => ({ id: n.name().slice(6), x: n.x() / 8, y: n.y() / 8, rot: n.rotation() }));
  });
  return new Map(list.map((b) => [b.id, b]));
}

/** Where a connection of a drawn brick is, studs. */
const connAt = (b: Shown, local: Pt): Pt => add({ x: b.x, y: b.y }, rot(local, b.rot));

/** Studs → CSS px on the page, with the stage as it is now. */
function toScreen(page: Page, p: Pt): Promise<Pt> {
  return page.evaluate((s) => {
    const st = (window as unknown as {
      Konva: { stages: { container: () => HTMLElement; getAbsoluteTransform: () => { point: (q: { x: number; y: number }) => { x: number; y: number } } }[] };
    }).Konva.stages[0]!;
    const box = st.container().getBoundingClientRect();
    const a = st.getAbsoluteTransform().point({ x: s.x * 8, y: s.y * 8 });
    return { x: box.left + a.x, y: box.top + a.y };
  }, p);
}

/** Is a bend handle drawn and grabbed at this page point (Konva's hit test, as a finger)? */
function handleAt(page: Page, at: Pt): Promise<boolean> {
  return page.evaluate((s) => {
    type N = { name: () => string; getParent: () => N | null };
    const st = (window as unknown as {
      Konva: { stages: { container: () => HTMLElement; getIntersection: (p: { x: number; y: number }) => N | null }[] };
    }).Konva.stages[0]!;
    const box = st.container().getBoundingClientRect();
    let n = st.getIntersection({ x: s.x - box.left, y: s.y - box.top });
    while (n) {
      if (n.name() === 'bend-handle') return true;
      n = n.getParent();
    }
    return false;
  }, at);
}

/**
 * Where the bend handles are drawn this frame (page px): each handle's ring
 * drawn into a recording context, as Konva draws it. (Konva leaves its hit
 * test as it was while a part is dragged, so this checks what's drawn.)
 */
function handleCentres(page: Page): Promise<Pt[]> {
  return page.evaluate(() => {
    type S = {
      getClassName: () => string;
      sceneFunc: () => (ctx: unknown, shape: S) => void;
      getAbsoluteTransform: () => { point: (q: { x: number; y: number }) => { x: number; y: number } };
    };
    type N = { name: () => string; getChildren: () => S[]; getParent: () => { hasName: (n: string) => boolean } | null };
    const st = (window as unknown as {
      Konva: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] };
    }).Konva.stages[0]!;
    const box = st.container().getBoundingClientRect();
    return st
      .find((n) => n.name() === 'bend-handle' && !!n.getParent()?.hasName('bend-rings'))
      .map((g) => {
        const ring = g.getChildren().find((c) => c.getClassName() === 'Shape')!;
        let at = { x: NaN, y: NaN };
        const ctx = {
          beginPath: () => undefined,
          closePath: () => undefined,
          moveTo: () => undefined,
          lineTo: () => undefined,
          fillStrokeShape: () => undefined,
          arc: (x: number, y: number) => {
            at = { x, y };
          },
        };
        ring.sceneFunc()(ctx, ring);
        const a = ring.getAbsoluteTransform().point(at);
        return { x: box.left + a.x, y: box.top + a.y };
      });
  });
}

/**
 * Record, every time the handles' layer is really drawn, where its rings
 * went (page px): what the screen shows, not what a draw would show now.
 */
async function recordDraws(page: Page): Promise<void> {
  await page.evaluate(() => {
    type S = {
      getClassName: () => string;
      sceneFunc: () => (ctx: unknown, shape: S) => void;
      getAbsoluteTransform: () => { point: (q: { x: number; y: number }) => { x: number; y: number } };
    };
    type G = { name: () => string; getChildren: () => S[]; getParent: () => { hasName: (n: string) => boolean } | null };
    type L = { name: () => string; drawScene: (...a: unknown[]) => unknown; find: (f: (n: G) => boolean) => G[] };
    const w = window as unknown as {
      Konva: { Layer: { prototype: L }; stages: { container: () => HTMLElement }[] };
      bendDrawn_: { x: number; y: number }[];
    };
    w.bendDrawn_ = [];
    const orig = w.Konva.Layer.prototype.drawScene;
    w.Konva.Layer.prototype.drawScene = function (this: L, ...a: unknown[]) {
      const out = orig.apply(this, a);
      if (this.name() === 'bend-layer') {
        const box = w.Konva.stages[0]!.container().getBoundingClientRect();
        w.bendDrawn_ = this.find((n) => n.name() === 'bend-handle' && !!n.getParent()?.hasName('bend-rings')).map((g) => {
          const ring = g.getChildren().find((c) => c.getClassName() === 'Shape')!;
          let at = { x: NaN, y: NaN };
          const ctx = {
            beginPath: () => undefined,
            closePath: () => undefined,
            moveTo: () => undefined,
            lineTo: () => undefined,
            fillStrokeShape: () => undefined,
            arc: (x: number, y: number) => {
              at = { x, y };
            },
          };
          ring.sceneFunc()(ctx, ring);
          const p = ring.getAbsoluteTransform().point(at);
          return { x: box.left + p.x, y: box.top + p.y };
        });
      }
      return out;
    };
  });
}

/** The screen shows a handle within 2 px of this page point (as last drawn). */
async function shownAt(page: Page, p: Pt): Promise<boolean> {
  const drawn = await page.evaluate(() => (window as unknown as { bendDrawn_: Pt[] }).bendDrawn_);
  return drawn.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 2);
}

/** A handle is drawn within 2 px of this page point. */
async function drawnAt(page: Page, p: Pt): Promise<boolean> {
  return (await handleCentres(page)).some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 2);
}

/** How many bend handles are drawn (their rings). */
const handleCount = (page: Page) =>
  page.evaluate(() => {
    type N = { name: () => string; getParent: () => { hasName: (n: string) => boolean } | null };
    const st = (window as unknown as { Konva: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva.stages[0]!;
    return st.find((n) => n.name() === 'bend-handle' && !!n.getParent()?.hasName('bend-rings')).length;
  });

type Touch = (type: string, pts: Pt[]) => Promise<unknown>;
function fingers(cdp: CDPSession): Touch {
  return (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
}

async function newLayout(page: Page, bricks: Placed[]): Promise<string> {
  const res = await page.request.post('/api/layouts', { data: { title: 'Flex touch', bbm: bbmWith(bricks) } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** Open a layout in edit mode at about Aaron's 139% zoom, `centre` (studs) in the middle. */
async function openAt(page: Page, id: string, count: number, centre: Pt): Promise<Touch> {
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await expect.poll(() => shown(page).then((b) => b.size)).toBe(count);
  const touch = fingers(await page.context().newCDPSession(page));
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  // Bring `centre` to the middle with a finger on empty map, then zoom in.
  const vp = page.viewportSize()!;
  const c = await toScreen(page, centre);
  const from = { x: 40, y: vp.height * 0.4 };
  await touch('touchStart', [from]);
  for (let i = 1; i <= 10; i++) {
    await touch('touchMove', [{ x: from.x + ((vp.width / 2 - c.x) * i) / 10, y: from.y + ((vp.height * 0.45 - c.y) * i) / 10 }]);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', []);
  for (let i = 0; i < 12; i++) {
    const z = await page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());
    if (z >= 1.3) break;
    await page.getByRole('button', { name: 'Zoom in' }).first().tap();
    await page.waitForTimeout(120);
  }
  return touch;
}

async function tap(page: Page, touch: Touch, studs: Pt) {
  const p = await toScreen(page, studs);
  await touch('touchStart', [p]);
  await touch('touchEnd', []);
}

/** The run's ends as drawn: the first female's rail end and the last male's. */
async function runEnds(page: Page, first: string, last: string): Promise<[Pt, Pt]> {
  const b = await shown(page);
  return [connAt(b.get(first)!, FEMALE.rail), connAt(b.get(last)!, MALE.rail)];
}

test.describe('bending flex track by touch', () => {
  test.use(pixel7);

  test('a finger bends the run by its end until it snaps and joins a loose set', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
    await signIn(page, `flextouch-bend-${ts}-${seq++}@example.com`, 'Flex Toucher');
    const sets = 4;
    const bend = 5;
    const last = String(900 + 2 * sets - 1);
    // A probe layout: the halves' sprite centres against their boxes (hull offsets).
    const probe = await newLayout(page, flexRow(sets, 100, 60));
    await page.goto(`/editor/${probe}`);
    await expect.poll(() => shown(page).then((b) => b.size)).toBe(2 * sets);
    const flat = await shown(page);
    const fOff = sub({ x: flat.get('900')!.x, y: flat.get('900')!.y }, { x: 99.2, y: 60 });
    const mOff = sub({ x: flat.get('901')!.x, y: flat.get('901')!.y }, { x: 100.8, y: 60 });
    // Where the run's end is when each of its hinges bends 5 degrees.
    let at = connAt(flat.get('900')!, FEMALE.rail);
    let turn = 0;
    for (let k = 0; k < sets; k++) {
      const joint = add(sub(at, rot(FEMALE.rail, turn)), rot(FEMALE.pivot, turn));
      at = add(sub(joint, rot(MALE.pivot, turn + bend)), rot(MALE.rail, turn + bend));
      turn += bend;
    }
    // A loose set beyond it, its female's rail end there, facing back.
    const fPivot = sub(at, rot(FEMALE.rail, turn));
    const mPivot = sub(add(fPivot, rot(FEMALE.pivot, turn)), rot(MALE.pivot, turn));
    const bricks = [...flexRow(sets, 100, 60), ...turnedSet([sub(fPivot, rot(fOff, turn)), sub(mPivot, rot(mOff, turn))], turn)];
    const id = await newLayout(page, bricks);
    const touch = await openAt(page, id, bricks.length, { x: 108, y: 61 });
    const target = connAt((await shown(page)).get(String(900 + 2 * sets))!, FEMALE.rail);
    expect(Math.hypot(target.x - at.x, target.y - at.y)).toBeLessThan(0.05);

    // Tap the run's second set: handles on both free ends of the whole run.
    await tap(page, touch, { x: 104, y: 60 });
    await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', '2 picked');
    await expect.poll(() => handleCount(page)).toBe(2);
    const [, end] = await runEnds(page, '900', last);
    expect(await handleAt(page, await toScreen(page, end))).toBe(true);

    // A finger drags the right handle to just short of the loose set.
    const from = await toScreen(page, end);
    const to = await toScreen(page, add(target, { x: -0.5, y: 0.3 }));
    await recordDraws(page);
    await touch('touchStart', [from]);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
      // The handle stays on the run's end as it bends, frame by frame, on screen.
      const [, now] = await runEnds(page, '900', last);
      const at = await toScreen(page, now);
      await expect.poll(() => shownAt(page, at), { message: `frame ${i}`, timeout: 1000 }).toBe(true);
    }
    await touch('touchEnd', []);

    // Joined: the run's end is on the loose set's end, facing it.
    await expect
      .poll(async () => {
        const [, e] = await runEnds(page, '900', last);
        return Math.hypot(e.x - target.x, e.y - target.y);
      })
      .toBeLessThan(0.2);
    expect(Math.abs((await shown(page)).get(last)!.rot - turn)).toBeLessThan(2);
    // Linked: the run now goes on through the loose set, so its end handle
    // is on the loose set's far end, and none is left at the joint.
    const looseEnd = connAt((await shown(page)).get(String(900 + 2 * sets + 1))!, MALE.rail);
    await expect.poll(async () => drawnAt(page, await toScreen(page, looseEnd))).toBe(true);
    expect(await drawnAt(page, await toScreen(page, target))).toBe(false);
    expect(await handleAt(page, await toScreen(page, looseEnd))).toBe(true);
    // One undo step puts it back.
    await page.getByRole('button', { name: 'Undo' }).first().tap();
    await expect.poll(async () => (await shown(page)).get(last)!.rot).toBe(0);
  });

  test('a handle stays on its end while the part moves, after undo, and when someone else moves it', async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
    const email = `flextouch-follow-${ts}-${seq++}@example.com`;
    await signIn(page, email, 'Flex Toucher');
    const bricks = flexRow(3, 100, 60);
    const id = await newLayout(page, bricks);
    const touch = await openAt(page, id, bricks.length, { x: 104, y: 60 });
    const last = String(900 + bricks.length - 1);
    // Pick the last set: the run's handles are on its two free ends.
    await tap(page, touch, { x: 108, y: 60 });
    await expect.poll(() => handleCount(page)).toBe(2);
    // The picked halves show handles on their free ends, not the big gold
    // connection dots Aaron saw beside them.
    const dots = await page.evaluate((id) => {
      type N = { getClassName: () => string; getChildren: () => N[] };
      const st = (window as unknown as { Konva: { stages: { findOne: (s: string) => N | undefined }[] } }).Konva.stages[0]!;
      return st.findOne(`.brick-${id}`)?.getChildren().filter((c) => c.getClassName() === 'Circle').length;
    }, String(900 + bricks.length - 1));
    expect(dots).toBe(0);
    const lastEnd = async () => connAt((await shown(page)).get(last)!, MALE.rail);

    // A finger moves the set, 1.5 studs from its end (on the part, inside
    // the handle's 44 px target but off its ring): the set moves, and its
    // end's handle goes with it, frame by frame, before it's committed.
    const from = await toScreen(page, { x: 108.55, y: 60 });
    await recordDraws(page);
    await touch('touchStart', [from]);
    for (let i = 1; i <= 12; i++) {
      await touch('touchMove', [{ x: from.x + 3 * i, y: from.y + 8 * i }]);
      const end = await toScreen(page, await lastEnd());
      await expect.poll(() => shownAt(page, end), { message: `frame ${i}`, timeout: 1000 }).toBe(true);
    }
    await touch('touchEnd', []);
    const moved = await lastEnd();
    expect(moved.y).toBeGreaterThan(61);
    // A finger on the set itself moves it; it doesn't bend it.
    expect((await shown(page)).get(last)!.rot).toBe(0);
    await expect.poll(async () => handleAt(page, await toScreen(page, await lastEnd()))).toBe(true);

    // Undo: back where it was, and so is the handle.
    await page.getByRole('button', { name: 'Undo' }).first().tap();
    await expect.poll(async () => (await lastEnd()).y).toBeLessThan(60.05);
    await expect.poll(async () => drawnAt(page, await toScreen(page, await lastEnd()))).toBe(true);
    expect(await handleAt(page, await toScreen(page, await lastEnd()))).toBe(true);

    // A finger just past the end, off the part but inside the handle's
    // 44 px target, bends it (it used to pan the map instead).
    const ring = await toScreen(page, await lastEnd());
    const offPart = { x: ring.x + 16, y: ring.y };
    expect(await handleAt(page, offPart)).toBe(true);
    const viewBefore = await page.evaluate(() => (window as unknown as { Konva: { stages: { x: () => number }[] } }).Konva.stages[0]!.x());
    await touch('touchStart', [offPart]);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', [{ x: offPart.x - 2 * i, y: offPart.y - 5 * i }]);
      await page.waitForTimeout(20);
    }
    await touch('touchEnd', []);
    await expect.poll(async () => Math.abs((await shown(page)).get(last)!.rot)).toBeGreaterThan(1);
    expect(await page.evaluate(() => (window as unknown as { Konva: { stages: { x: () => number }[] } }).Konva.stages[0]!.x())).toBe(viewBefore);
    await page.getByRole('button', { name: 'Undo' }).first().tap();
    await expect.poll(async () => (await shown(page)).get(last)!.rot).toBe(0);

    // Someone else (the same account on another phone) moves the run.
    const other = await browser.newContext({ ...pixel7 });
    const page2 = await other.newPage();
    await signIn(page2, email, 'Flex Toucher');
    const touch2 = await openAt(page2, id, bricks.length, { x: 104, y: 60 });
    const p2 = await toScreen(page2, { x: 108, y: 60 });
    await tap(page2, touch2, { x: 108, y: 60 });
    await expect.poll(() => handleCount(page2)).toBe(2);
    await touch2('touchStart', [p2]);
    for (let i = 1; i <= 10; i++) {
      await touch2('touchMove', [{ x: p2.x - 2 * i, y: p2.y - 8 * i }]);
      await page2.waitForTimeout(20);
    }
    await touch2('touchEnd', []);
    // Here the set moves live, and the handle with it.
    await expect.poll(async () => (await lastEnd()).y, { timeout: 10000 }).toBeLessThan(59);
    await expect.poll(async () => drawnAt(page, await toScreen(page, await lastEnd()))).toBe(true);
    expect(await handleAt(page, await toScreen(page, await lastEnd()))).toBe(true);
    await other.close();
  });
});

test.describe('bending flex track with a real, shaky finger', () => {
  test.use(pixel7);

  test('near the loose set the join takes hold once and never flickers off and on', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
    test.slow(); // a slowed CPU
    await page.addInitScript(() => localStorage.setItem('cld:snapTrace', '1'));
    await signIn(page, `flextouch-shaky-${ts}-${seq++}@example.com`, 'Flex Toucher');
    const sets = 4;
    const bend = 5;
    const last = String(900 + 2 * sets - 1);
    const probe = await newLayout(page, flexRow(sets, 100, 60));
    await page.goto(`/editor/${probe}`);
    await expect.poll(() => shown(page).then((b) => b.size)).toBe(2 * sets);
    const flat = await shown(page);
    const fOff = sub({ x: flat.get('900')!.x, y: flat.get('900')!.y }, { x: 99.2, y: 60 });
    const mOff = sub({ x: flat.get('901')!.x, y: flat.get('901')!.y }, { x: 100.8, y: 60 });
    let at = connAt(flat.get('900')!, FEMALE.rail);
    let turn = 0;
    for (let k = 0; k < sets; k++) {
      const joint = add(sub(at, rot(FEMALE.rail, turn)), rot(FEMALE.pivot, turn));
      at = add(sub(joint, rot(MALE.pivot, turn + bend)), rot(MALE.rail, turn + bend));
      turn += bend;
    }
    const fPivot = sub(at, rot(FEMALE.rail, turn));
    const mPivot = sub(add(fPivot, rot(FEMALE.pivot, turn)), rot(MALE.pivot, turn));
    const bricks = [...flexRow(sets, 100, 60), ...turnedSet([sub(fPivot, rot(fOff, turn)), sub(mPivot, rot(mOff, turn))], turn)];
    const id = await newLayout(page, bricks);
    const touch = await openAt(page, id, bricks.length, { x: 108, y: 61 });
    const target = connAt((await shown(page)).get(String(900 + 2 * sets))!, FEMALE.rail);
    await tap(page, touch, { x: 104, y: 60 });
    await expect.poll(() => handleCount(page)).toBe(2);
    const [, end] = await runEnds(page, '900', last);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // A seeded wobble with uneven gaps and pressure-only moves (as Android
    // Chrome sends them, at the same point).
    let seed = 99;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const samePoint = (p: Pt) =>
      page.evaluate((q) => {
        const target = document.querySelector('.konvajs-content canvas') ?? document.body;
        const t = new Touch({ identifier: 0, target, clientX: q.x, clientY: q.y, force: 0.7 });
        target.dispatchEvent(new TouchEvent('touchmove', { touches: [t], changedTouches: [t], targetTouches: [t], bubbles: true, cancelable: true }));
      }, p);
    const from = await toScreen(page, end);
    const near = await toScreen(page, add(target, { x: -0.3, y: 0.2 }));
    await touch('touchStart', [from]);
    for (let i = 1; i <= 30; i++) {
      const p = { x: from.x + ((near.x - from.x) * i) / 30 + (r() - 0.5) * 2, y: from.y + ((near.y - from.y) * i) / 30 + (r() - 0.5) * 2 };
      await touch('touchMove', [p]);
      if (i % 3 === 0) await samePoint(p);
      await page.waitForTimeout(8 + Math.floor(r() * 33));
    }
    // Then out to the edge of the finger's reach (28 px) and hovering there,
    // across that edge and back: the hold (1.6x) keeps it joined.
    const z = await page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());
    const reach = Math.min(4, Math.max(0.5, 28 / (8 * z)));
    const edge = await toScreen(page, add(target, { x: -reach, y: 0 }));
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: near.x + ((edge.x - near.x) * i) / 8, y: near.y + ((edge.y - near.y) * i) / 8 }]);
      await page.waitForTimeout(8 + Math.floor(r() * 33));
    }
    for (let i = 0; i < 30; i++) {
      const p = { x: edge.x + (r() - 0.5) * 6, y: edge.y + (r() - 0.5) * 6 };
      await touch('touchMove', [p]);
      if (r() < 0.4) await samePoint(p);
      await page.waitForTimeout(i % 15 === 14 ? 220 : 8 + Math.floor(r() * 33));
    }
    await touch('touchEnd', []);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    type F = { decision: string; target: string | null; kind: string };
    const frames = (await page.evaluate(() => (window as unknown as { __cldSnapTrace: () => unknown[] }).__cldSnapTrace())) as F[];
    expect(frames.every((f) => f.kind === 'flex')).toBe(true);
    const dropTarget = frames.at(-1)!.target;
    expect(dropTarget, 'joined on release').not.toBeNull();
    const first = frames.findIndex((f) => f.target === dropTarget);
    const flickers = frames.slice(first + 1).filter((f) => f.decision === 'release').length;
    if (flickers > 0) console.log(JSON.stringify(frames));
    expect(flickers, 'no release while the finger stays close').toBe(0);
  });
});

