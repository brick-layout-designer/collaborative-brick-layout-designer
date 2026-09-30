// The layout file (.bld-layout): the editor downloads the whole layout in
// one file, the image included; a .bld-layout the desktop made opens with
// its labels, venue and background; and a .bbm download says what
// BlueBrick leaves out.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { signIn } from '../helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const TIGHT_CORNER = readFileSync(join(FIXTURES, 'tight-corner.bbm'), 'utf-8');
const CORNER_LOBBY = readFileSync(join(FIXTURES, 'corner-lobby.bld-layout'));
const EMAIL = `layout-file-e2e-${Date.now()}@example.com`;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const SIDECAR = JSON.stringify({
  schemaVersion: 1,
  bbmHashSha256: '',
  anchoredLabels: [{
    id: '777', text: 'File Label', font: { family: 'Arial', size: 24, style: 'Regular' },
    color: { known: true, argb: 4278190080, name: 'Black' },
    kind: 0, targetId: '', offset: { x: 10, y: 10 }, rot: 0, minZoom: 0,
  }],
  backgroundImage: { file: 'background.png', opacity: 0.4 },
});

/** A zip's entries (stored or deflated), by name, in order. */
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

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000); // WS sync + first render settle
}

/** A layout with a label and a background image, made as opening a .bld-layout makes it. */
async function layoutWithImage(page: Page): Promise<string> {
  await signIn(page, EMAIL, 'File Tester');
  const res = await page.request.post('/api/layouts', {
    data: { title: 'File Test', bbm: TIGHT_CORNER, sidecar: SIDECAR, backgroundImage: { type: 'image/png', data: PNG.toString('base64') } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test.describe('layout file', () => {
  test('Download Layout gives one file with the layout, its label and its image', async ({ page }) => {
    const id = await layoutWithImage(page);
    await openEditor(page, id);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Layout (.bld-layout)' }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('File Test.bld-layout');

    const entries = unzip(readFileSync(await download.path()));
    expect([...entries.keys()]).toEqual(['manifest.json', 'layout.bbm', 'background.png', 'sidecar.json']);
    expect(JSON.parse(entries.get('manifest.json')!.toString())).toMatchObject({ format: 'bld-layout', version: 1 });
    expect(entries.get('layout.bbm')!.toString()).toContain('<Map');
    expect(entries.get('background.png')!.equals(PNG)).toBe(true);
    const sidecar = JSON.parse(entries.get('sidecar.json')!.toString()) as {
      anchoredLabels: { text: string }[];
      backgroundImage: Record<string, unknown>;
    };
    expect(sidecar.anchoredLabels.map((l) => l.text)).toEqual(['File Label']);
    expect(sidecar.backgroundImage).toEqual({ opacity: 0.4, file: 'background.png' });
  });

  test('a .bld-layout from the desktop opens by drop, with its label, venue and image', async ({ page }) => {
    await signIn(page, EMAIL, 'File Tester');
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'corner-lobby.bld-layout'));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [...CORNER_LOBBY]);

    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    const id = page.url().split('/editor/')[1]!;
    const sidecar = (await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as {
      anchoredLabels: { text: string }[];
      venue?: { name: string };
      backgroundImage: { url: string; opacity: number };
    };
    expect(sidecar.anchoredLabels.map((l) => l.text)).toEqual(['Grand Lobby — north end']);
    expect(sidecar.venue?.name).toBeTruthy();
    expect(sidecar.backgroundImage).toMatchObject({ url: `/api/layouts/${id}/background-image`, opacity: 0.3 });
    const image = await page.request.get(sidecar.backgroundImage.url);
    expect(image.headers()['content-type']).toBe('image/png');
    expect((await image.body()).subarray(1, 4).toString()).toBe('PNG');
  });

  test('the create dialog opens a .bld-layout too', async ({ page }) => {
    await signIn(page, EMAIL, 'File Tester');
    await page.goto('/');
    await page.getByRole('button', { name: 'New layout' }).first().click();
    await page.locator('input[type=file][accept*=".bld-layout"]').setInputFiles({
      name: 'corner-lobby.bld-layout',
      mimeType: 'application/zip',
      buffer: CORNER_LOBBY,
    });
    await expect(page.getByPlaceholder('Untitled Layout')).toHaveValue('corner-lobby');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    const id = page.url().split('/editor/')[1]!;
    const sidecar = (await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as {
      backgroundImage: { url: string };
    };
    expect(sidecar.backgroundImage.url).toBe(`/api/layouts/${id}/background-image`);
    expect((await page.request.get(sidecar.backgroundImage.url)).ok()).toBe(true);
  });

  test('Download As .bbm says what BlueBrick leaves out and gives the bare map', async ({ page }) => {
    const id = await layoutWithImage(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Download As...' }).click();
    const dialog = page.getByRole('dialog', { name: 'Download As' });
    await expect(dialog.getByLabel('Brick Layout Designer layout (.bld-layout)')).toBeChecked();
    await dialog.getByLabel('BlueBrick map (.bbm)').check();
    await expect(dialog).toContainText("BlueBrick can't hold anchored labels, the background image");
    const dl = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('File Test.bbm');
    expect(readFileSync(await download.path(), 'utf-8')).toContain('<Map');
  });
});
