// A module dragged by a finger: its outline and name move with it every
// frame, before the finger lifts (they used to wait for the release), and
// it is highlighted as one module, not as each of its parts. Touches go
// through CDP, so this runs in Chromium with a phone's touch screen.

import { test, expect, devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { signIn } from '../helpers';

const { defaultBrowserType: _d, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../../../../packages/bbm/tests/fixtures/render-parity/parity.bld-layout');

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const out = new Map<string, Buffer>();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

/** On-screen points of a Konva node by name, and the stage. */
function screen(page: Page, what: 'frame' | 'name' | 'brick', id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([what, id]) => {
      type N = { name: () => string; getClassName: () => string; getAbsolutePosition: () => { x: number; y: number }; findOne: (s: string) => N | undefined };
      const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; findOne: (s: string) => N | undefined }[] } }).Konva?.stages[0];
      if (!st) return null;
      const box = st.container().getBoundingClientRect();
      const node =
        what === 'brick' ? st.findOne(`.brick-${id}`) : st.findOne(`.module-label-${id}`)?.findOne(what === 'frame' ? '.module-frame' : '.module-name');
      if (!node) return null;
      const a = node.getAbsolutePosition();
      return { x: box.left + a.x, y: box.top + a.y };
    },
    [what, id] as const,
  );
}

function count(page: Page, name: string): Promise<number> {
  return page.evaluate((name) => {
    type N = { name: () => string; isVisible: () => boolean };
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    return st ? st.find((n) => n.name().split(' ').includes(name)).length : 0;
  }, name);
}

test('a module dragged by a finger takes its outline and name along before the finger lifts', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
  test.setTimeout(90_000);
  const file = unzip(readFileSync(FIXTURE));
  await signIn(page, `module-drag-${Date.now()}@example.com`, 'Finger');
  // The parity layout's modules, without its room (so the view fits the parts).
  const sidecar = JSON.parse(file.get('sidecar.json')!.toString('utf-8')) as { modules: { id: string; members: string[] }[]; venue?: unknown };
  delete sidecar.venue;
  const res = await page.request.post('/api/layouts', {
    data: { title: 'Module drag', bbm: file.get('layout.bbm')!.toString('utf-8'), sidecar: JSON.stringify(sidecar) },
  });
  const { id } = (await res.json()) as { id: string };
  const town = sidecar.modules.find((m) => m.id === 'M2')!;
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  await expect.poll(() => screen(page, 'frame', 'M2'), { timeout: 15000 }).not.toBeNull();

  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 0 }] : [] });

  // A tap on one of its parts picks the whole module, highlighted as one.
  let at: { x: number; y: number } | null = null;
  for (const m of town.members) {
    const p = await screen(page, 'brick', m);
    if (!p) continue;
    await touch('touchStart', p);
    await touch('touchEnd');
    if ((await count(page, 'module-selected')) === 1) {
      at = p;
      break;
    }
  }
  expect(at).not.toBeNull();
  await expect(page.getByTestId('touch-bar')).toHaveAttribute('aria-label', `${town.members.length} picked`);
  expect(await count(page, 'module-selected')).toBe(1);

  // Drag it, finger still down: the outline and the name have moved.
  const frame0 = (await screen(page, 'frame', 'M2'))!;
  const name0 = (await screen(page, 'name', 'M2'))!;
  await touch('touchStart', at!);
  for (let i = 1; i <= 10; i++) await touch('touchMove', { x: at!.x + 6 * i, y: at!.y + 4 * i });
  await expect.poll(async () => (await screen(page, 'frame', 'M2'))!.x - frame0.x).toBeGreaterThan(40);
  const frame1 = (await screen(page, 'frame', 'M2'))!;
  const name1 = (await screen(page, 'name', 'M2'))!;
  expect(frame1.y - frame0.y).toBeGreaterThan(25);
  expect(name1.x - name0.x).toBeCloseTo(frame1.x - frame0.x, 0);
  expect(name1.y - name0.y).toBeCloseTo(frame1.y - frame0.y, 0);
  // Lifted: they stay where the module went.
  await touch('touchEnd');
  await page.waitForTimeout(1500);
  const frame2 = (await screen(page, 'frame', 'M2'))!;
  expect(Math.abs(frame2.x - frame1.x)).toBeLessThan(8);
});

// A perf guard: dragging one part of a module being edited, on a layout of
// about a thousand parts (Fordyce 2026), must not draw the parts' layer
// again every frame: only the dragged part (on the drag layer) and the
// module's outline (its own layer) are.
test('a drag in Edit module on a big layout redraws only what moves', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'uses CDP touch emulation');
  test.setTimeout(90_000);
  const bbm = readFileSync(join(HERE, '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'), 'utf-8');
  const ids = [...bbm.matchAll(/<Brick id="([^"]+)"/g)].map((m) => m[1]!);
  expect(ids.length).toBeGreaterThan(900);
  const members = ids.slice(0, 200);
  const sidecar = { schemaVersion: 1, bbmHashSha256: '', modules: [{ id: 'M', name: 'Big module', members, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] }] };
  await signIn(page, `module-perf-${Date.now()}@example.com`, 'Finger');
  const res = await page.request.post('/api/layouts', { data: { title: 'Big', bbm, sidecar: JSON.stringify(sidecar) } });
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  await page.waitForTimeout(2000);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 0 }] : [] });
  // A member on top, double-tapped: Edit module.
  const vw = page.viewportSize()!;
  let at: { x: number; y: number } | null = null;
  for (const m of members) {
    const p = await screen(page, 'brick', m);
    if (!p || p.x < 40 || p.x > vw.width - 40 || p.y < 200 || p.y > vw.height - 200) continue;
    await touch('touchStart', p);
    await touch('touchEnd');
    await page.waitForTimeout(60);
    await touch('touchStart', p);
    await touch('touchEnd');
    if (await page.getByTestId('module-edit-bar').isVisible().catch(() => false)) {
      at = p;
      break;
    }
    await page.waitForTimeout(400);
  }
  expect(at).not.toBeNull();
  await touch('touchStart', at!);
  await touch('touchEnd');
  // Count every layer's draws while the part is dragged out of the module.
  await page.evaluate(() => {
    type L = { name: () => string; drawScene: (...a: unknown[]) => unknown };
    const w = window as unknown as { Konva: { Layer: { prototype: L } }; draws_: Record<string, number> };
    w.draws_ = {};
    const orig = w.Konva.Layer.prototype.drawScene;
    w.Konva.Layer.prototype.drawScene = function (this: L, ...a: unknown[]) {
      const k = this.name() || '(unnamed)';
      w.draws_[k] = (w.draws_[k] ?? 0) + 1;
      return orig.apply(this, a);
    };
  });
  await touch('touchStart', at!);
  for (let i = 1; i <= 30; i++) {
    await touch('touchMove', { x: at!.x + i * 4, y: at!.y + i * 8 });
    await page.waitForTimeout(16);
  }
  const draws = await page.evaluate(() => (window as unknown as { draws_: Record<string, number> }).draws_);
  await touch('touchEnd');
  expect(draws['drag-layer'] ?? 0).toBeGreaterThan(10);
  // The thousand parts: drawn once when the part is lifted out, not per frame.
  expect(draws['parts-layer'] ?? 0).toBeLessThanOrEqual(3);
});
