// E2E: desktop-parity editor features — anchored-label placement, part-
// number Find & Replace, the rotate / z-order toolbar buttons, the View
// entries of the Map menu, "Download .bbm", the Export Image options and
// the drop-target hint.
//
// Set SHOT_DIR to also save screenshots of the new controls.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const FORDYCE_BBM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm',
  ),
  'utf-8',
);

const EMAIL = `parity-e2e-${Date.now()}@example.com`;

async function createLayout(page: Page, bbm?: string): Promise<string> {
  await signIn(page, EMAIL, 'Parity Tester');
  const res = await page.request.post('/api/layouts', {
    data: bbm ? { title: 'Parity Test', bbm } : { title: 'Parity Test' },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function openEditor(page: Page, id: string): Promise<void> {
  await page.goto(`/editor/${id}`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000); // WS sync + first render settle
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.SHOT_DIR;
  if (dir) await page.screenshot({ path: join(dir, name) });
}

interface ExportedLabel {
  text: string;
  kind: number;
  targetId: string;
  offset: { x: number; y: number };
}

/** The layout's live sidecar labels, via the desktop-named sidecar export. */
async function exportedLabels(page: Page, id: string): Promise<ExportedLabel[]> {
  const res = await page.request.get(`/api/layouts/${id}/export.bbm.bld`);
  if (!res.ok()) return [];
  return ((await res.json()) as { anchoredLabels?: ExportedLabel[] }).anchoredLabels ?? [];
}

function countPart(bbm: string, part: string): number {
  return bbm.split(`<PartNumber>${part}</PartNumber>`).length - 1;
}

test.describe('anchored labels — default placement', () => {
  test('a World label is placed at the viewport centre', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    // Empty layout: no auto-fit, so the view is at pan 0 / zoom 1 and the
    // stage centre is (width/2, height/2) px = /8 studs.
    const { iw, ih } = await page.evaluate(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
    const expected = {
      x: Math.round(((iw - 260) / 2 / 8) * 100) / 100,
      y: Math.round(((ih - 48) / 2 / 8) * 100) / 100,
    };

    await page.keyboard.press('Control+l');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Add Anchored Label');
    await dialog.locator('input[type="text"]').first().fill('Centre');
    await dialog.getByRole('button', { name: 'Add Label' }).click();

    await expect.poll(async () => (await exportedLabels(page, id)).map((l) => l.text)).toEqual(['Centre']);
    const [label] = await exportedLabels(page, id);
    expect(label!.kind).toBe(0);
    expect(label!.offset.x).toBeCloseTo(expected.x, 1);
    expect(label!.offset.y).toBeCloseTo(expected.y, 1);
  });

  test('a label on the selected brick defaults to offset (2, -2)', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);

    // Select exactly one brick through Find (clicking a match selects it).
    await page.keyboard.press('Control+f');
    const find = page.getByRole('dialog');
    await find.getByPlaceholder('Search…').fill('3857.0');
    await find.locator('ul button').first().click();
    await find.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('footer')).toContainText('selected: 1');

    await page.keyboard.press('Control+l');
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('select')).toHaveValue('1');
    await dialog.locator('input[type="text"]').first().fill('On brick');
    await dialog.getByRole('button', { name: 'Add Label' }).click();

    await expect.poll(async () => (await exportedLabels(page, id)).length).toBe(1);
    const [label] = await exportedLabels(page, id);
    expect(label!.kind).toBe(1);
    expect(label!.targetId).not.toBe('');
    expect(label!.offset).toEqual({ x: 2, y: -2 });
  });
});

test.describe('find & replace — part numbers', () => {
  test('Replace changes the current match; Replace all the rest, as one undo step', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);

    await page.keyboard.press('Control+f');
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Search…').fill('3857.0');
    await expect(dialog).toContainText('72 matches');
    await dialog.getByPlaceholder('New part-number text…').fill('3857.5');
    await shot(page, 'find-replace.png');

    await dialog.getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(dialog).toContainText('71 matches');
    // Let the undo manager close its capture window so the two replaces
    // stay separate undo steps.
    await page.waitForTimeout(800);
    await dialog.getByRole('button', { name: 'Replace all' }).click();
    await expect(dialog).toContainText('No matches.');

    const bbm = () => page.request.get(`/api/layouts/${id}/export.bbm`).then((r) => r.text());
    await expect.poll(async () => countPart(await bbm(), '3857.5')).toBe(72);
    expect(countPart(await bbm(), '3857.0')).toBe(0);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    // Undo reverts the whole Replace all (71 bricks) in one step.
    await expect.poll(async () => countPart(await bbm(), '3857.0')).toBe(71);
    expect(countPart(await bbm(), '3857.5')).toBe(1);
  });
});

test.describe('toolbar and menus', () => {
  test('rotate / z-order buttons act on the selection', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);

    const rotateCw = page.getByRole('button', { name: 'Rotate CW' });
    await expect(rotateCw).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Bring to Front' })).toBeDisabled();

    await page.keyboard.press('Control+a');
    await expect(rotateCw).toBeEnabled();
    await shot(page, 'toolbar-buttons.png');
    await rotateCw.click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await page.getByRole('button', { name: 'Send to Back' }).click();
    await page.getByRole('button', { name: 'Rotate CCW' }).click();
    await page.getByRole('button', { name: 'Bring to Front' }).click();
  });

  test('Map menu zoom entries, Insert Text and Download .bbm', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const footer = page.locator('footer');
    const zoomText = async () => (await footer.innerText()).match(/Zoom: (\d+)%/)?.[1];

    const before = await zoomText();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await shot(page, 'map-menu.png');
    await page.getByRole('button', { name: /^Zoom In/ }).click();
    await expect.poll(zoomText).not.toBe(before);
    const zoomed = await zoomText();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /^Zoom Out/ }).click();
    await expect.poll(zoomText).not.toBe(zoomed);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /^Fit to View/ }).click();

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /^Insert Text/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .bbm' }).click();
    expect((await download).suggestedFilename()).toBe('Parity_Test.bbm');
  });

  test('Export Image offers size, JPEG quality and antialias', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Export as Image...' }).click();

    const width = page.getByLabel('Width (px)');
    const height = page.getByLabel('Height (px)');
    await expect(height).toBeDisabled(); // keep aspect on
    await width.fill('800');
    const autoH = Number(await height.inputValue());
    expect(autoH).toBeGreaterThan(0);
    await page.getByLabel('Keep aspect ratio (height auto)').uncheck();
    await height.fill('300');
    await page.locator('select').filter({ hasText: 'JPEG' }).selectOption('jpeg');
    await expect(page.getByLabel('JPEG quality')).toBeVisible();
    await expect(page.getByLabel('Antialias')).toBeChecked();
    await shot(page, 'export-image.png');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JPEG' }).click();
    expect((await download).suggestedFilename()).toBe('Parity_Test.jpg');
  });
});

test.describe('drag and drop', () => {
  test('dragging a part over the canvas shows the drop-target layer', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const part = page.locator('aside li button[draggable="true"]').first();
    await expect(part).toBeVisible({ timeout: 10000 });
    const stage = page.locator('.konvajs-content').first();
    const box = (await stage.boundingBox())!;

    await part.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 });
    await expect(page.locator('footer')).toContainText('Drop onto: ');
    await shot(page, 'drop-hint.png');
    await page.mouse.up();
    await expect(page.locator('footer')).not.toContainText('Drop onto: ');
  });
});

test.describe('module drag ghost', () => {
  test('dragging a library module draws its ghost, then drops it', async ({ page }) => {
    // A module made from the Fordyce layout's snapshot.
    const sourceId = await createLayout(page, FORDYCE_BBM);
    const snapshot = await (await page.request.get(`/api/layouts/${sourceId}/snapshot`)).body();
    const mod = await page.request.post('/api/modules', { data: { title: 'Fordyce Loop' } });
    const { id: moduleId } = (await mod.json()) as { id: string };
    const put = await page.request.put(`/api/modules/${moduleId}/snapshot`, {
      data: snapshot,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(put.ok()).toBe(true);

    const hostId = await createLayout(page);
    await openEditor(page, hostId);
    await page.getByRole('button', { name: 'Panels' }).click();
    await page.getByLabel('Module Library').check();
    await page.mouse.click(400, 400); // click-away backdrop closes the menu
    const row = page.locator('li[draggable="true"]', { hasText: 'Fordyce Loop' });
    await expect(row).toBeVisible({ timeout: 10000 });
    // Zoom out so the whole (~1150-stud-wide) module fits in view.
    for (let i = 0; i < 14; i++) await page.keyboard.press('Control+-');

    const stage = page.locator('.konvajs-content').first();
    const box = (await stage.boundingBox())!;
    const hud = page.locator('.konvajs-content canvas').last();
    const hudInk = () =>
      hud.evaluate((el: HTMLCanvasElement) => {
        const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4 * 13) if (d[i]! > 0) n++;
        return n;
      });
    const inkBefore = await hudInk();

    await row.hover();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await expect(page.locator('footer')).toContainText('Drop onto: ');
    // Nudge so a dragover fires after the snapshot has loaded.
    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(300);
      await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 2);
    }
    await expect.poll(hudInk).toBeGreaterThan(inkBefore + 100);
    await shot(page, 'module-ghost.png');
    await page.mouse.up();

    await expect(page.locator('footer')).toContainText('Imported ');
    const bbm = await (await page.request.get(`/api/layouts/${hostId}/export.bbm`)).text();
    expect(bbm.split('<Brick id=').length - 1).toBeGreaterThan(900);
  });
});

test.describe('anchored labels — colour round-trip', () => {
  test('editing a label with a known colour keeps the colour in the doc', async ({ page }) => {
    await signIn(page, EMAIL, 'Parity Tester');
    const sidecar = JSON.stringify({
      schemaVersion: 1,
      bbmHashSha256: '',
      anchoredLabels: [{
        id: '4242', text: 'Colour Test', font: { family: 'Arial', size: 24, style: 'Regular' },
        color: { known: true, argb: 4294901760, name: 'Red' },
        kind: 0, targetId: '', offset: { x: 40, y: 30 }, rot: 0, minZoom: 0,
      }],
    });
    const res = await page.request.post('/api/layouts', { data: { title: 'Parity Test', sidecar } });
    const { id } = (await res.json()) as { id: string };
    await openEditor(page, id);

    // Empty map → pan 0 / zoom 1, so the label's top-left is at (320, 240) px.
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    await page.mouse.dblclick(box.x + 320 + 20, box.y + 240 + 10);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Edit Anchored Label');
    await expect(dialog.locator('input[type="color"]')).toHaveValue('#ff0000');
    await dialog.locator('input[type="text"]').first().fill('Colour Kept');
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect.poll(async () => (await exportedLabels(page, id))[0]?.text).toBe('Colour Kept');
    const raw = await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json() as {
      anchoredLabels: { id: string; color: unknown }[];
    };
    expect(raw.anchoredLabels[0]!.id).toBe('4242');
    expect(raw.anchoredLabels[0]!.color).toEqual({ known: true, argb: 4294901760, name: 'Red' });
  });
});

test.describe('insert text', () => {
  test('Map → Insert Text places the text at the view centre', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    const { iw, ih } = await page.evaluate(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
    const centre = { x: (iw - 260) / 2 / 8, y: (ih - 48) / 2 / 8 };

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /^Insert Text/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="text"], textarea').first().fill('Centred');
    await dialog.getByRole('button', { name: 'OK' }).click();

    const cell = async () => {
      const bbm = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
      const m = /<TextCell>\s*<DisplayArea>\s*<X>([^<]+)<\/X>\s*<Y>([^<]+)<\/Y>\s*<Width>([^<]+)<\/Width>\s*<Height>([^<]+)<\/Height>/.exec(bbm);
      return m ? { x: Number(m[1]) + Number(m[3]) / 2, y: Number(m[2]) + Number(m[4]) / 2 } : null;
    };
    await expect.poll(cell).not.toBeNull();
    const c = (await cell())!;
    expect(c.x).toBeCloseTo(centre.x, 1);
    expect(c.y).toBeCloseTo(centre.y, 1);
  });
});

test.describe('venue library', () => {
  test('Rename via the ✎ button lists the new name', async ({ page }) => {
    const id = await createLayout(page);
    const name = `Hall ${Date.now()}`;
    const created = await page.request.post('/api/venues', {
      data: { name, data: { name, enabled: true, minWalkwayStuds: 0, bounds: { x: 0, y: 0, w: 0, h: 0 }, edges: [], obstacles: [] } },
    });
    expect(created.ok()).toBe(true);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Panels' }).click();
    await page.getByLabel('Venue Library').check();
    await page.mouse.click(400, 400); // close the menu

    const renamed = `${name} (main)`;
    page.once('dialog', (d) => void d.accept(renamed));
    await page.getByRole('button', { name: `Rename ${name}` }).click();
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    await shot(page, 'venue-rename.png');
    const list = await (await page.request.get('/api/venues')).json() as { venues: { name: string }[] };
    expect(list.venues.map((v) => v.name)).toContain(renamed);
  });
});

test.describe('budget limits', () => {
  test('a limit persists across reload and other sessions, and .bbb save / open still work', async ({ page, browser }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const openBudget = async (p: Page) => {
      await p.getByRole('button', { name: 'Map', exact: true }).click();
      await p.getByRole('button', { name: 'Budget...' }).click();
    };
    // The Budget table's first row (the Parts filter also uses a '—' placeholder).
    const budgetRow = (p: Page) => p.locator('tbody tr').filter({ has: p.locator('input[placeholder="—"]') }).first();
    const limitInput = (p: Page) => budgetRow(p).locator('input[placeholder="—"]');
    await openBudget(page);
    await limitInput(page).fill('5');
    const part = await budgetRow(page).locator('td').first().innerText();
    await expect(page.locator('footer')).toContainText('Budget: ');

    await page.waitForTimeout(500); // let the update reach the server
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await openBudget(page);
    await expect(limitInput(page)).toHaveValue('5');

    // Another session sees the shared limit.
    const ctx2 = await browser.newContext();
    await signIn(ctx2, EMAIL);
    const page2 = await ctx2.newPage();
    await openEditor(page2, id);
    await openBudget(page2);
    await expect(limitInput(page2)).toHaveValue('5');
    await ctx2.close();

    // .bbb export carries the limit…
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save…' }).click();
    const download = await dl;
    const file = await download.path();
    const xml = readFileSync(file, 'utf-8');
    expect(xml).toContain(`<PartNumber>${part}</PartNumber>`);
    expect(xml).toContain('<Limit>5</Limit>');

    // …and importing it restores the limit after New cleared it.
    await page.getByRole('button', { name: 'New', exact: true }).last().click();
    await expect(limitInput(page)).toHaveValue('');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open…' }).click();
    await (await chooser).setFiles(file);
    await expect(limitInput(page)).toHaveValue('5');
  });
});

test.describe('header dropdowns at a narrow viewport', () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test('Map and Panels menus open fully inside the viewport', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const inside = async (menu: import('@playwright/test').Locator) => {
      await expect(menu).toBeVisible();
      const b = (await menu.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1024);
      expect(b.y + b.height).toBeLessThanOrEqual(700);
      expect(b.height).toBeGreaterThan(100);
    };

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const mapMenu = page.locator('ul', { has: page.getByRole('button', { name: 'General info...' }) });
    await inside(mapMenu);
    await shot(page, 'map-menu-1024.png');
    // The last entry is reachable (the menu scrolls instead of overflowing).
    const prefs = page.getByRole('button', { name: /^Preferences/ });
    await prefs.scrollIntoViewIfNeeded();
    await expect(prefs).toBeInViewport();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(mapMenu).toHaveCount(0);

    await page.getByRole('button', { name: 'Panels' }).click();
    const panelsMenu = page.locator('ul', { has: page.getByLabel('Module Library') });
    await inside(panelsMenu);
  });
});
