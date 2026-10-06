// Two people on one layout: a part picked on a phone and deleted on a
// computer leaves the phone's selection. The touch bar used to go on
// saying "1 picked", with Rotate and Duplicate for a part that was gone.

import { test, expect, devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FORDYCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm'),
  'utf-8',
);
function twoCurves(): string {
  const xml = [0, 30]
    .map(
      (x, i) =>
        `<Brick id="${900 + i}"><DisplayArea><X>${x}</X><Y>0</Y><Width>16</Width><Height>8</Height></DisplayArea>` +
        '<MyGroup /><PartNumber>2867.8</PartNumber><Orientation>0</Orientation>' +
        '<ActiveConnectionPointIndex>0</ActiveConnectionPointIndex><Altitude>0</Altitude><Connexions count="0" /></Brick>',
    )
    .join('');
  const first = /<Layer type="brick"[\s\S]*?<\/Layer>/.exec(FORDYCE)![0];
  const layer = first.replace(/<Bricks>[\s\S]*<\/Bricks>/, `<Bricks>${xml}</Bricks>`);
  return FORDYCE.replace(/<Layer type="(brick|ruler|text)"[\s\S]*?<\/Layer>/g, '').replace(/(<Layers[^>]*>)/, `$1${layer}`);
}
function shown(page: Page): Promise<{ id: string; sx: number; sy: number }[]> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string; getAbsolutePosition: () => { x: number; y: number } };
    const st = (window as unknown as { Konva?: { stages: { container: () => HTMLElement; find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    if (!st) return [];
    const box = st.container().getBoundingClientRect();
    return st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-')).map((n) => {
      const a = n.getAbsolutePosition();
      return { id: n.name().slice(6), sx: box.left + a.x, sy: box.top + a.y };
    });
  });
}
const { defaultBrowserType: _b, ...pixel7 } = devices['Pixel 7'];

test('a part picked on a phone and deleted elsewhere leaves the phone\'s selection', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch emulation');
  const desk = await browser.newContext({ viewport: { width: 1300, height: 850 } });
  await signIn(desk, `stale-pick-${Date.now()}@example.com`, 'Stale Pick');
  const a = await desk.newPage();
  const res = await a.request.post('/api/layouts', { data: { title: 'Stale pick', bbm: twoCurves() } });
  const { id } = (await res.json()) as { id: string };
  const phone = await browser.newContext({ ...pixel7 });
  await phone.addCookies(await desk.cookies());
  const b = await phone.newPage();
  await a.goto(`/editor/${id}`);
  await b.goto(`/editor/${id}`);
  await expect.poll(() => shown(a).then((x) => x.length), { timeout: 15000 }).toBe(2);
  await expect.poll(() => shown(b).then((x) => x.length), { timeout: 15000 }).toBe(2);
  await b.getByTestId('mode-switch').getByRole('radio', { name: 'Edit' }).tap();
  const cdp = await phone.newCDPSession(b);
  const [first] = await shown(b);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first!.sx, y: first!.sy, id: 0 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const bar = b.getByTestId('touch-bar');
  await expect(bar).toHaveAttribute('aria-label', '1 picked');

  // On the computer: pick everything and delete it.
  const area = (await a.locator('.konvajs-content').first().boundingBox())!;
  await a.mouse.click(area.x + 5, area.y + area.height - 5);
  await a.keyboard.press('Control+a');
  await a.keyboard.press('Delete');
  await expect.poll(() => shown(b).then((x) => x.length), { timeout: 10000 }).toBe(0);
  // The phone's bar is back to Add part.
  await expect(b.getByTestId('add-part')).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'Touch editing');
});
