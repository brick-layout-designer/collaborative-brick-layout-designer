// The map must look the same on the web and in the desktop. Both apps draw
// render-parity/parity.bld-layout's saved views at the same size (Export
// all views, Small): parity.bld-layout (modules, a see-through sheet, text,
// the room) and rulers-areas.bld-layout. The desktop's tests/ui/RenderParityTest.cpp draws the
// same views from its own copy of the fixture.
//
// Each picture is compared with this app's golden PNG
// (e2e/fixtures/render-parity/web/<view>.png) within a small tolerance.
// Fonts differ between machines, so the golden is checked only when
// RENDER_GOLDENS=1 (a local gate, like the desktop's); the shared
// description of the module look (packages/bbm/tests/fixtures/render-parity/
// modules.json) is checked in CI by the unit tests. PARITY_OUT=<dir> saves
// the pictures there; UPDATE_GOLDENS=1 rewrites the goldens.

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { signIn } from '../helpers';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '../../../../packages/bbm/tests/fixtures/render-parity');
const GOLDENS = join(HERE, '../fixtures/render-parity/web');
const OUT = process.env.PARITY_OUT;

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

/** The share of pixels more than 8/255 apart in any channel (both PNGs decoded by the browser). */
async function diffShare(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const pixels = async (b64: string) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d')!;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [p, q] = [await pixels(x), await pixels(y)];
      if (p.width !== q.width || p.height !== q.height) return 1;
      let off = 0;
      for (let i = 0; i < p.data.length; i += 4) {
        if (Math.abs(p.data[i]! - q.data[i]!) > 8 || Math.abs(p.data[i + 1]! - q.data[i + 1]!) > 8 || Math.abs(p.data[i + 2]! - q.data[i + 2]!) > 8) off++;
      }
      return off / (p.width * p.height);
    },
    [a.toString('base64'), b.toString('base64')] as const,
  );
}

for (const stem of ['parity', 'rulers-areas']) {
  test(`the ${stem} layout draws the same pictures as its goldens`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const file = unzip(readFileSync(join(FIXTURES, `${stem}.bld-layout`)));
    await signIn(page, `parity-${stem}-${Date.now()}@example.com`, 'Parity Tester');
    const background = file.get('background.png');
    const res = await page.request.post('/api/layouts', {
      data: {
        title: 'Parity',
        bbm: file.get('layout.bbm')!.toString('utf-8'),
        sidecar: file.get('sidecar.json')!.toString('utf-8'),
        ...(background ? { backgroundImage: { type: 'image/png', data: background.toString('base64') } } : {}),
      },
    });
    expect(res.status()).toBe(201);
    const id = ((await res.json()) as { id: string }).id;
    await page.addInitScript(() => localStorage.setItem('cld:exportViews', JSON.stringify({ maxSide: 1280 })));
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.getByRole('group', { name: 'Tasks' }).getByRole('button', { name: 'Build' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('region', { name: 'Views' }).getByRole('button', { name: 'Export all views' }).click();
    const pictures = unzip(readFileSync(await (await dl).path()));
    expect(pictures.size).toBe(2);

    for (const [name, png] of pictures) {
      const view = name.replace(/^Parity - /, '');
      if (OUT) {
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, view), png);
      }
      if (process.env.UPDATE_GOLDENS === '1') {
        mkdirSync(GOLDENS, { recursive: true });
        writeFileSync(join(GOLDENS, view), png);
      } else if (process.env.RENDER_GOLDENS === '1') {
        expect(await diffShare(page, png, readFileSync(join(GOLDENS, view))), view).toBeLessThanOrEqual(0.002);
      }
    }
  });
}
