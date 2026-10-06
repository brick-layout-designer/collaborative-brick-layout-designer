// The layout file (.bld-layout): the editor downloads the whole layout in
// one file, the image included; a .bld-layout the desktop made opens with
// its labels, venue and background; and a .bbm download says what
// BlueBrick leaves out.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { signIn, mapMenu } from '../helpers';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures');
const TIGHT_CORNER = readFileSync(join(FIXTURES, 'tight-corner.bbm'), 'utf-8');
const CORNER_LOBBY = readFileSync(join(FIXTURES, 'corner-lobby.bld-layout'));
// One brick of the desktop user's own part CLDTEST.1, which the file carries.
const WITH_PARTS = readFileSync(join(FIXTURES, 'with-parts.bld-layout'));
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

    const dl = page.waitForEvent('download');
    await mapMenu(page, 'Download & export', 'Download layout (.bld-layout)');
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
    await mapMenu(page, 'Download & export', 'Download as…');
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

  test('a dropped .bld-layout brings its own parts as custom parts, and downloads with them', async ({ page }) => {
    await signIn(page, EMAIL, 'File Tester');
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'with-parts.bld-layout'));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [...WITH_PARTS]);
    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    await expect(page.locator('footer')).toContainText('1 part from the layout added to your custom parts');

    const mine = (await (await page.request.get('/api/custom-parts')).json()) as { parts: { id: string; partNumber: string }[] };
    const part = mine.parts.find((p) => p.partNumber === 'CLDTEST.1');
    expect(part).toBeTruthy();
    expect((await page.request.get(`/api/custom-parts/${part!.id}/sprite`)).headers()['content-type']).toBe('image/png');

    // Downloaded again, the layout carries it.
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    const dl = page.waitForEvent('download');
    await mapMenu(page, 'Download & export', 'Download layout (.bld-layout)');
    const entries = unzip(readFileSync(await (await dl).path()));
    expect([...entries.keys()].filter((n) => n.startsWith('parts/'))).toEqual(['parts/CLDTEST.1.png', 'parts/CLDTEST.1.xml']);

    // Dropped again: the server has the part now, so nothing is uploaded twice.
    await page.goto('/');
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'with-parts.bld-layout'));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [...WITH_PARTS]);
    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    const after = (await (await page.request.get('/api/custom-parts')).json()) as { parts: { partNumber: string }[] };
    expect(after.parts.filter((p) => p.partNumber === 'CLDTEST.1')).toHaveLength(1);
  });

  test("a dropped .bld-layout whose part differs from the server's asks, and Keep both switches it to CLDTEST-2.1", async ({ page }) => {
    await signIn(page, `part-differs-e2e-${Date.now()}@example.com`, 'Differs Tester');
    // The server's own CLDTEST.1, defined differently from the file's.
    const up = await page.request.post('/api/custom-parts', {
      data: {
        partNumber: 'CLDTEST.1',
        displayName: 'Server test part',
        xmlBase64: Buffer.from('<part><Author>Server</Author><Description><en>Server test part</en></Description></part>').toString('base64'),
        spriteBase64: PNG.toString('base64'),
        spriteMime: 'image/png',
      },
    });
    expect(up.status()).toBe(201);

    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate((bytes) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'with-parts.bld-layout'));
      window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [...WITH_PARTS]);

    const dialog = page.getByRole('dialog', { name: 'Parts That Differ' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog).toContainText('CLDTEST.1');
    await expect(dialog).toContainText('Server test part');
    await expect(dialog).toContainText('Test part');
    await expect(dialog).toContainText('by Brick Layout Designer tests');
    const choice = dialog.getByLabel('Use for CLDTEST.1');
    await expect(choice).toHaveValue('server');
    await choice.selectOption('both');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    await expect(page.locator('footer')).toContainText("the layout's CLDTEST.1 as CLDTEST-2.1 added");
    const id = page.url().split('/editor/')[1]!;
    const bbm = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
    expect(bbm).toContain('<PartNumber>CLDTEST-2.1</PartNumber>');
    expect(bbm).not.toContain('<PartNumber>CLDTEST.1</PartNumber>');

    const mine = (await (await page.request.get('/api/custom-parts')).json()) as { parts: { id: string; partNumber: string }[] };
    expect(mine.parts.map((p) => p.partNumber).sort()).toEqual(['CLDTEST-2.1', 'CLDTEST.1']);
    const added = mine.parts.find((p) => p.partNumber === 'CLDTEST-2.1')!;
    expect(await (await page.request.get(`/api/custom-parts/${added.id}/xml`)).text()).toContain('Brick Layout Designer tests');
    const kept = mine.parts.find((p) => p.partNumber === 'CLDTEST.1')!;
    expect(await (await page.request.get(`/api/custom-parts/${kept.id}/xml`)).text()).toContain('<Author>Server</Author>');
  });
});
