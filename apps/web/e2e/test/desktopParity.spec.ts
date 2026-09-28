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
    await find.getByRole('combobox').selectOption('part');
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
    await dialog.getByRole('combobox').selectOption('part');
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
    // Four edits of all ~1000 Fordyce bricks, each synced; up to ~33 s on a dev machine.
    test.slow();
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
    // No sidecar yet: the bare .bbm, named like the server export.
    expect((await download).suggestedFilename()).toBe('Parity Test.bbm');
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
    // Loads the Fordyce map twice (source and module); up to ~30 s on a dev machine.
    test.slow();
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

    // The drop selects the imported bricks. (The "Imported …" status
    // message fades after a moment, so it is not a reliable check.)
    await expect(page.locator('footer')).toContainText(/selected: \d{3,}/);
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

  test('Ctrl+T puts Arial 12 black text at the view centre on a Labels layer, whatever the mouse', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    const { iw, ih } = await page.evaluate(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
    const centre = { x: (iw - 260) / 2 / 8, y: (ih - 48) / 2 / 8 };
    // Mouse over the canvas, well away from its centre.
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 40);

    await page.keyboard.press('Control+t');
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="text"], textarea').first().fill('Yard');
    await dialog.getByRole('button', { name: 'OK' }).click();

    const bbm = () => page.request.get(`/api/layouts/${id}/export.bbm`).then((r) => r.text());
    await expect.poll(async () => /<TextCell>/.test(await bbm())).toBe(true);
    const xml = await bbm();
    const cellXml = xml.slice(xml.indexOf('<TextCell>'), xml.indexOf('</TextCell>'));
    const num = (tag: string) => Number(new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(cellXml)![1]);
    expect(num('X') + num('Width') / 2).toBeCloseTo(centre.x, 1);
    expect(num('Y') + num('Height') / 2).toBeCloseTo(centre.y, 1);
    expect(num('Height')).toBe(10);
    expect(num('Width')).toBe(24); // max(10 * 0.6 * 4 characters, 20)
    expect(cellXml).toMatch(/<FontColor>\s*<IsKnownColor>true<\/IsKnownColor>\s*<Name>Black<\/Name>/);
    expect(cellXml).toMatch(/<Size>12<\/Size>/);
    expect(xml).toMatch(/<Layer type="text" id="[^"]+">\s*<Name>Labels<\/Name>/);
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
    // Loads the 500-brick Fordyce map more than once; ~25-35 s on a dev machine.
    test.slow();
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
    // Vanilla BlueBrick's layout (Budget.cpp): <PartList><Part id="…">N</Part>, CRLF.
    expect(xml).toContain(`    <Part id="${part}">5</Part>\r\n`);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\r\n<Budget>\r\n')).toBe(true);

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

test.describe('find — modeless', () => {
  test('selects every match live and leaves the editor usable while open', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);

    await page.keyboard.press('Control+f');
    const find = page.getByRole('dialog', { name: 'Find & Replace' });
    await find.getByRole('combobox').selectOption('part');
    await find.getByPlaceholder('Search…').fill('3857.0');
    // No click on a result: typing alone selects all 72 matches.
    await expect(page.locator('footer')).toContainText('selected: 72');
    await shot(page, 'find-modeless.png');

    // The toolbar still works with the panel open (no modal backdrop).
    await page.getByRole('button', { name: 'Rotate CW' }).click();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
    await expect(find).toBeVisible();

    await find.getByPlaceholder('Search…').fill('');
    await expect(page.locator('footer')).not.toContainText('selected: 72');
    await find.press('Escape');
    await expect(find).toHaveCount(0);
  });
});

test.describe('venue drawing', () => {
  test('fewer than 3 points is refused; a finished outline enables the venue and shows its status', async ({ page }) => {
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const footer = page.locator('footer');
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    const at = (dx: number, dy: number) => page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Venue → Draw Outline...' }).click();
    await at(-40, -40);
    await at(40, -40);
    await page.keyboard.press('Enter');
    await expect(footer).toContainText('Venue polygon needs at least 3 points');
    expect(((await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as { venue?: unknown }).venue ?? null).toBeNull();

    // Still in the tool: a small triangle in the middle of the layout
    // finishes the outline, and most of the layout lies outside it.
    await at(-40, -40);
    await at(40, -40);
    await at(0, 40);
    await page.keyboard.press('Enter');
    await expect(footer).toContainText(/Venue: \d+ issue\(s\)/);
    await shot(page, 'venue-status.png');

    const venue = async () =>
      ((await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as {
        venue?: { enabled: boolean; edges: unknown[]; minWalkwayStuds: number };
      }).venue;
    await expect.poll(async () => (await venue())?.edges.length).toBe(3);
    const v = (await venue())!;
    expect(v.enabled).toBe(true);
    expect(v.minWalkwayStuds).toBe(112.5);
  });
});

/** Entries of a stored (uncompressed) zip, read through its central directory. */
function readStoredZip(buf: Buffer): Map<string, string> {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const out = new Map<string, string>();
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    expect(buf.readUInt16LE(p + 10)).toBe(0); // stored
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    const local = buf.readUInt32LE(p + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    out.set(name, buf.toString('utf-8', start, start + size));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const LABEL_SIDECAR = JSON.stringify({
  schemaVersion: 1,
  bbmHashSha256: '',
  anchoredLabels: [{
    id: '777', text: 'Sidecar Label', font: { family: 'Arial', size: 24, style: 'Regular' },
    color: { known: true, argb: 4278190080, name: 'Black' },
    kind: 0, targetId: '', offset: { x: 10, y: 10 }, rot: 0, minZoom: 0,
  }],
});

test.describe('.bbm with its .bbm.bld sidecar', () => {
  test('Download .bbm delivers a zip with both files when the layout has a sidecar', async ({ page }) => {
    await signIn(page, EMAIL, 'Parity Tester');
    const res = await page.request.post('/api/layouts', { data: { title: 'Parity Test', bbm: FORDYCE_BBM, sidecar: LABEL_SIDECAR } });
    const { id } = (await res.json()) as { id: string };
    await openEditor(page, id);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .bbm' }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toBe('Parity Test.zip');

    const entries = readStoredZip(readFileSync(await download.path()));
    expect([...entries.keys()]).toEqual(['Parity Test.bbm', 'Parity Test.bbm.bld']);
    expect(entries.get('Parity Test.bbm')).toContain('<Map');
    const sidecar = JSON.parse(entries.get('Parity Test.bbm.bld')!) as {
      bbmHashSha256: string;
      anchoredLabels: { text: string }[];
    };
    expect(sidecar.anchoredLabels.map((l) => l.text)).toEqual(['Sidecar Label']);
    // Hashed against the .bbm in the same zip, so desktop sees no drift.
    const { createHash } = await import('node:crypto');
    expect(sidecar.bbmHashSha256).toBe(createHash('sha256').update(entries.get('Parity Test.bbm')!).digest('hex'));
  });

  test('dropping a .bbm together with its .bbm.bld opens a layout with both', async ({ page }) => {
    await signIn(page, EMAIL, 'Parity Tester');
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    await page.evaluate(
      ({ bbm, sidecar }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([bbm], 'dropped.bbm', { type: 'application/xml' }));
        dt.items.add(new File([sidecar], 'dropped.bbm.bld', { type: 'application/json' }));
        window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      },
      { bbm: FORDYCE_BBM, sidecar: LABEL_SIDECAR },
    );

    await expect(page).toHaveURL(/\/editor\/[^/]+$/, { timeout: 15000 });
    const id = page.url().split('/editor/')[1]!;
    await expect.poll(async () => (await exportedLabels(page, id)).map((l) => l.text)).toEqual(['Sidecar Label']);
    const bbm = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
    expect(countPart(bbm, '3857.0')).toBe(72);
  });
});

test.describe('scale bar', () => {
  test('bottom-left, in studs over mm / m, and it follows the zoom', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    const bar = page.getByTestId('scale-bar');
    // Empty map → zoom 1 (8 px per stud): the 120 px target picks 16 studs.
    await expect(bar).toHaveText(/16 studs\s*128 mm/);
    // Lower-left of the visible canvas: next to its left edge, just above the status bar.
    const canvas = (await page.locator('.konvajs-content').first().boundingBox())!;
    const footer = (await page.locator('footer').boundingBox())!;
    const b = (await bar.boundingBox())!;
    expect(b.x - canvas.x).toBeLessThan(20);
    expect(footer.y - (b.y + b.height)).toBeGreaterThanOrEqual(0);
    expect(footer.y - (b.y + b.height)).toBeLessThan(20);

    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+-');
    await expect(bar).not.toHaveText(/16 studs/);
    await expect(bar).toHaveText(/\d+ studs\s*(\d+ mm|\d+\.\d\d m)/);
  });
});

test.describe('use budget limitation', () => {
  test('duplicate over budget is refused with the Budget reached box, then status only', async ({ page }) => {
    test.slow();
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const bbm = () => page.request.get(`/api/layouts/${id}/export.bbm`).then((r) => r.text());

    // Budget 3857.0 at exactly its 72 uses, and turn the limitation on.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget...' }).click();
    const row = page.locator('tbody tr', { hasText: '3857.0' });
    await row.locator('input[placeholder="—"]').fill('72');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget → Use Budget Limitation' }).click();
    // Close the Budget panel so it doesn't cover the Find panel.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget...' }).click();

    // Select one 3857.0 through Find, then duplicate it.
    await page.keyboard.press('Control+f');
    const find = page.getByRole('dialog', { name: 'Find & Replace' });
    await find.getByRole('combobox').selectOption('part');
    await find.getByPlaceholder('Search…').fill('3857.0');
    await find.locator('ul button').first().click();
    await find.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('footer')).toContainText('selected: 1');

    await page.keyboard.press('Control+d');
    const box = page.getByRole('dialog', { name: 'Budget reached' });
    await expect(box).toBeVisible();
    await expect(page.locator('footer')).toContainText('Budget reached: part not added');
    await shot(page, 'budget-reached.png');
    await box.getByLabel("Don't show this message again").check();
    await box.getByRole('button', { name: 'OK' }).click();
    await expect(box).toHaveCount(0);

    // Again: refused silently apart from the status bar.
    await page.keyboard.press('Control+d');
    await expect(page.locator('footer')).toContainText('Budget reached: part not added');
    await expect(box).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(countPart(await bbm(), '3857.0')).toBe(72);
  });
});

test.describe('budget in the parts panel', () => {
  test('Show Budget Numbers and Show Only Budgeted Parts', async ({ page }) => {
    test.slow();
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const tiles = page.locator('aside li button[draggable="true"]');
    await expect(tiles.first()).toBeVisible({ timeout: 10000 });
    const allTiles = await tiles.count();

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget...' }).click();
    await page.locator('tbody tr', { hasText: '3857.0' }).locator('input[placeholder="—"]').fill('10');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget...' }).click(); // close the panel

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget → Show Only Budgeted Parts' }).click();
    // Only parts with a limit above 0 remain: 3857.0.
    await expect(tiles).toHaveCount(1);
    await expect(tiles.first()).toHaveAttribute('title', /3857\.0/);

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget → Show Budget Numbers' }).click();
    await expect(tiles.first().getByTestId('budget-numbers')).toHaveText('72/10');
    await expect(tiles.first()).toHaveClass(/bg-red-900/);
    await shot(page, 'parts-budget.png');

    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Budget → Show Only Budgeted Parts' }).click();
    await expect(tiles).toHaveCount(allTiles);
    // Unbudgeted parts read "used/?".
    await expect(page.getByTestId('budget-numbers').filter({ hasText: /\/\?$/ }).first()).toBeVisible();
  });
});

test.describe('pivot geometry', () => {
  test('a part with a <hull> is placed with its footprint box and turns around its sprite centre', async ({ page }) => {
    const { footprint } = await import('@cld/parts-catalog');
    const id = await createLayout(page);
    await openEditor(page, id);
    const catalog = (await (await page.request.get('/api/parts/catalog')).json()) as {
      parts: { key: string; pxPerStud: number; spriteSize?: { w: number; h: number }; hullPts: { x: number; y: number }[] }[];
    };
    const part = catalog.parts.find((p) => p.key === '2861.8')!;
    expect(part.hullPts.length).toBeGreaterThan(0);
    expect(part.spriteSize).toBeTruthy();

    await page.getByPlaceholder(/Fuzzy filter/).fill('2861.8');
    await page.locator('aside li button[draggable="true"]', { hasText: /./ }).filter({ has: page.locator('img') }).first().dblclick();

    const brick = async () => {
      const xml = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
      const m = /<Brick id="[^"]+">[\s\S]*?<DisplayArea>\s*<X>([^<]+)<\/X>\s*<Y>([^<]+)<\/Y>\s*<Width>([^<]+)<\/Width>\s*<Height>([^<]+)<\/Height>[\s\S]*?<Orientation>([^<]+)<\/Orientation>/.exec(xml);
      return m ? { x: +m[1]!, y: +m[2]!, w: +m[3]!, h: +m[4]!, o: +m[5]! } : null;
    };
    await expect.poll(brick).not.toBeNull();
    const placed = (await brick())!;
    const fp0 = footprint(part, placed.o)!;
    expect(placed.w).toBeCloseTo(fp0.size.w, 3);
    expect(placed.h).toBeCloseTo(fp0.size.h, 3);
    const pivot0 = { x: placed.x + placed.w / 2 + fp0.imageOffset.x, y: placed.y + placed.h / 2 + fp0.imageOffset.y };

    await page.getByRole('button', { name: 'Rotate CW' }).click();
    await expect.poll(async () => (await brick())?.o).not.toBe(placed.o);
    const turned = (await brick())!;
    const fp1 = footprint(part, turned.o)!;
    expect(turned.w).toBeCloseTo(fp1.size.w, 3);
    expect(turned.h).toBeCloseTo(fp1.size.h, 3);
    // The sprite centre stays put: the brick turned in place.
    expect(turned.x + turned.w / 2 + fp1.imageOffset.x).toBeCloseTo(pivot0.x, 2);
    expect(turned.y + turned.h / 2 + fp1.imageOffset.y).toBeCloseTo(pivot0.y, 2);
  });
});

test.describe('chained placement', () => {
  test('double-clicking a track tile three times builds a straight run, each piece on the last one\'s free end', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    await page.getByPlaceholder(/Fuzzy filter/).fill('2865.8');
    const tile = page.locator('aside li button[draggable="true"]').filter({ has: page.locator('img') }).first();
    await expect(tile).toHaveAttribute('title', /2865\.8/);

    const bricks = async () => {
      const xml = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
      return [...xml.matchAll(/<Brick id="([^"]+)">[\s\S]*?<X>([^<]+)<\/X>\s*<Y>([^<]+)<\/Y>[\s\S]*?<\/Brick>/g)].map((m) => ({
        id: m[1]!,
        x: Number(m[2]),
        y: Number(m[3]),
        links: [...m[0].matchAll(/<LinkedTo>([^<]+)<\/LinkedTo>/g)].length,
      }));
    };
    // A single click only picks the tile (desktop places on activation).
    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    expect(await bricks()).toHaveLength(0);
    for (let n = 1; n <= 3; n++) {
      await tile.dblclick();
      await expect.poll(async () => (await bricks()).length).toBe(n);
    }
    // Wait for the links to reach the server.
    await expect.poll(async () => (await bricks()).reduce((s, b) => s + b.links, 0)).toBe(4);
    const run = await bricks();
    const xs = run.map((b) => b.x).sort((a, b) => a - b);
    // Three 16-stud pieces in a row: no piece placed on top of another.
    expect(xs[1]! - xs[0]!).toBeCloseTo(16, 3);
    expect(xs[2]! - xs[1]!).toBeCloseTo(16, 3);
    expect(new Set(run.map((b) => b.y.toFixed(3))).size).toBe(1);
    // The middle piece is linked at both ends, the outer ones at one.
    expect(run.map((b) => b.links).sort()).toEqual([1, 1, 2]);
  });
});

test.describe('placing a set', () => {
  test('a set lands as a module named after it, its pieces linked', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    await page.getByPlaceholder(/Fuzzy filter/).fill('rail_yard_left_turn');
    const tile = page.locator('aside li button[draggable="true"]').filter({ hasText: /Rail yard/ }).first();
    await expect(tile).toBeVisible({ timeout: 10000 });
    // Enter on the focused tile adds it, like a double-click (PartsBrowser.cpp:145).
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('footer')).toContainText('Placed set: Rail yard on the right (12 parts)');

    const sidecar = async () =>
      (await (await page.request.get(`/api/layouts/${id}/export.bbm.bld`)).json()) as { modules?: { name: string; members: string[] }[] };
    await expect.poll(async () => (await sidecar()).modules?.map((m) => [m.name, m.members.length])).toEqual([['Rail yard on the right', 12]]);
    // Module names (and frames) are on by default, like desktop view/moduleNames.
    const moduleLabels = () =>
      page.evaluate(() => {
        const K = (window as unknown as { Konva: { stages: { find: (s: string) => { text: () => string }[] }[] } }).Konva;
        return K.stages.flatMap((st) => st.find('Text')).map((t) => t.text()).filter((t) => t === 'Rail yard on the right').length;
      });
    await expect.poll(moduleLabels).toBeGreaterThan(0);
    // Set files carry positions only; the pieces are linked on placement.
    const links = async () => ((await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text()).match(/<LinkedTo>[^<]+<\/LinkedTo>/g) ?? []).length;
    await expect.poll(links).toBeGreaterThanOrEqual(22);
  });
});

test.describe('connection points', () => {
  test('free connection dots show only on the selected brick by default', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    const dots = () =>
      page.evaluate(() => {
        type Node = { getClassName: () => string; isVisible: () => boolean; getParent: () => { name: () => string } | null };
        const K = (window as unknown as { Konva: { stages: { find: (s: (n: Node) => boolean) => Node[] }[] } }).Konva;
        return K.stages
          .flatMap((st) => st.find((n: Node) => n.getClassName() === 'Circle'))
          .filter((c) => c.isVisible() && (c.getParent()?.name() ?? '').startsWith('brick-')).length;
      });

    // A placed piece is selected: its two free ends show.
    await page.getByPlaceholder(/Fuzzy filter/).fill('2865.8');
    await page.locator('aside li button[draggable="true"]').filter({ has: page.locator('img') }).first().dblclick();
    await expect(page.locator('footer')).toContainText('selected: 1');
    await expect.poll(dots).toBe(2);

    // Deselected: none, since Connection Points is off by default.
    await page.locator('.konvajs-content').first().click({ position: { x: 20, y: 20 } });
    await expect(page.locator('footer')).not.toContainText('selected: 1');
    await expect.poll(dots).toBe(0);
  });
});

test.describe('unresolved parts', () => {
  test('parts the library lacks draw as desktop\'s dashed pink placeholder', async ({ page }) => {
    // Fordyce with one more brick renamed to a part no library has.
    const bbm = FORDYCE_BBM.replace('<PartNumber>3857.0</PartNumber>', '<PartNumber>NO_SUCH_PART.1</PartNumber>');
    const id = await createLayout(page, bbm);
    await openEditor(page, id);
    // Bricks whose part the catalog can't resolve by key, part number or old name.
    const catalog = (await (await page.request.get('/api/parts/catalog')).json()) as {
      parts: { key: string; partNumber: string; oldNames?: string[] }[];
    };
    const known = new Set(catalog.parts.flatMap((p) => [p.key, p.partNumber, ...(p.oldNames ?? [])].map((k) => k.toLowerCase())));
    const unknown = [...bbm.matchAll(/<PartNumber>([^<]+)<\/PartNumber>/g)].filter((m) => !known.has(m[1]!.toLowerCase())).length;
    expect(unknown).toBeGreaterThan(0);

    const placeholders = () =>
      page.evaluate(() => {
        type Node = { stroke: () => string; dash: () => number[]; fill: () => string };
        const K = (window as unknown as { Konva: { stages: { find: (s: string) => Node[] }[] } }).Konva;
        return K.stages.flatMap((st) => st.find('.brick-unresolved')).map((r) => `${r.stroke()}|${r.dash().join(',')}|${r.fill()}`);
      });
    await expect.poll(async () => (await placeholders()).length).toBe(unknown);
    expect(new Set(await placeholders())).toEqual(new Set(['rgb(200,80,80)|4,2|rgba(255,200,200,0.314)']));
  });
});

test.describe('brick stacking', () => {
  test('a brick with a higher altitude is drawn above the rest of its layer', async ({ page }) => {
    // The first brick in the file, lifted to altitude 5.
    const bbm = FORDYCE_BBM.replace(/(<Brick id="5">[\s\S]*?<Altitude>)0(<\/Altitude>)/, '$15$2');
    const id = await createLayout(page, bbm);
    await openEditor(page, id);
    const position = () =>
      page.evaluate(() => {
        type Node = { name: () => string; getParent: () => { getChildren: () => Node[] } };
        const K = (window as unknown as { Konva: { stages: { findOne: (s: string) => Node | undefined }[] } }).Konva;
        const g = K.stages.map((st) => st.findOne('.brick-5')).find(Boolean);
        if (!g) return null;
        const siblings = g.getParent().getChildren();
        return { index: siblings.indexOf(g), last: siblings.length - 1 };
      });
    await expect.poll(async () => (await position())?.index).not.toBeUndefined();
    const p = (await position())!;
    expect(p.index).toBe(p.last);
  });
});

test.describe('grid cell indices', () => {
  test('columns and rows are labelled along the origin cell only, one axis per label', async ({ page }) => {
    // Fordyce's grid layer shows cell indices (letters across, numbers down).
    const id = await createLayout(page, FORDYCE_BBM);
    await openEditor(page, id);
    const labels = () =>
      page.evaluate(() => {
        type Node = { text: () => string; find: (s: string) => Node[] };
        const K = (window as unknown as { Konva: { stages: { find: (s: string) => Node[] }[] } }).Konva;
        return K.stages.flatMap((st) => st.find('.cell-index')).flatMap((g) => g.find('Text')).map((t) => t.text());
      });
    await expect.poll(async () => (await labels()).length).toBeGreaterThan(0);
    const texts = await labels();
    // Never the old "A1" per-cell labels: letters or numbers, never both.
    expect(texts.every((t) => /^[A-Z]+$/.test(t) || /^\d+$/.test(t))).toBe(true);
    expect(texts.some((t) => /^[A-Z]+$/.test(t))).toBe(true);
    expect(texts.some((t) => /^\d+$/.test(t))).toBe(true);
    await shot(page, 'grid-cell-index.png');
  });
});

test.describe('venue obstacles', () => {
  test('an obstacle needs a venue outline first; with one, the tool says how to draw', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    const footer = page.locator('footer');
    const drawObstacle = async () => {
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      await page.getByRole('button', { name: 'Venue → Draw Obstacle...' }).click();
    };

    let message = '';
    page.once('dialog', (d) => {
      message = d.message();
      void d.accept();
    });
    await drawObstacle();
    await expect.poll(() => message).toBe('Draw the venue outline first.');
    await expect(footer).toContainText('Tool: select');

    // Draw an outline, then the obstacle tool is allowed.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: 'Venue → Draw Outline...' }).click();
    await expect(footer).toContainText('Click points to outline the venue.');
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    for (const [dx, dy] of [[-60, -60], [60, -60], [0, 60]] as const) {
      await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    }
    await page.keyboard.press('Enter');
    await expect(footer).toContainText('Venue: OK');

    await drawObstacle();
    await expect(footer).toContainText('Click points to outline an obstacle.');
    await expect(footer).toContainText('Tool: venueObstacle');
  });
});

test.describe('drawing a ruler', () => {
  test('the preview reads studs and mm, and the ruler lands with desktop defaults on a Rulers layer', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Ruler ─' }).click();
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    const x0 = box.x + 200;
    const y0 = box.y + 200;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    // 160 px at zoom 1 = 20 studs.
    await page.mouse.move(x0 + 160, y0, { steps: 8 });
    const previewText = () =>
      page.evaluate(() => {
        type Node = { text: () => string };
        const K = (window as unknown as { Konva: { stages: { find: (s: string) => Node[] }[] } }).Konva;
        return K.stages.flatMap((st) => st.find('Text')).map((t) => t.text()).filter((t) => t.includes('studs ('));
      });
    await expect.poll(previewText).toContain('20.0 studs (160 mm)');
    await page.mouse.up();

    const xml = async () => (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
    await expect.poll(async () => /<LinearRuler/.test(await xml())).toBe(true);
    const x = await xml();
    expect(x).toMatch(/<Layer type="ruler" id="[^"]+">\s*<Name>Rulers<\/Name>/);
    const ruler = x.slice(x.indexOf('<LinearRuler'), x.indexOf('</LinearRuler>'));
    expect(ruler).toMatch(/<LineThickness>1<\/LineThickness>/);
    expect(ruler).toMatch(/<Color>\s*<IsKnownColor>true<\/IsKnownColor>\s*<Name>Black<\/Name>/);
  });
});

test.describe('fit to view', () => {
  test('fits text as well as bricks, centred, with desktop\'s 50 px margin', async ({ page }) => {
    // A map whose only content is a text cell far from the origin.
    const withText = FORDYCE_BBM
      .replace(/<Layer type="brick"[\s\S]*?<\/Layer>/g, '')
      .replace(/<Layer type="ruler"[\s\S]*?<\/Layer>/g, '')
      .replace(/(<Layer type="text" id="\d+">[\s\S]*?<TextCells>)[\s\S]*?(<\/TextCells>)/, (_m, a: string, b: string) =>
        `${a}<TextCell><DisplayArea><X>2000</X><Y>1000</Y><Width>40</Width><Height>10</Height></DisplayArea>` +
        '<Text>Far away</Text><Orientation>0</Orientation><FontColor><IsKnownColor>true</IsKnownColor><Name>Black</Name></FontColor>' +
        `<Font><FontFamily>Arial</FontFamily><Size>12</Size><Style>Regular</Style></Font><TextAlignment>Center</TextAlignment></TextCell>${b}`);
    const id = await createLayout(page, withText);
    await openEditor(page, id);
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByRole('button', { name: /^Fit to View/ }).click();
    const view = await page.evaluate(() => {
      type Stage = { x: () => number; y: () => number; scaleX: () => number; width: () => number; height: () => number };
      const K = (window as unknown as { Konva: { stages: Stage[] } }).Konva;
      const st = K.stages[0]!;
      return { x: st.x(), y: st.y(), z: st.scaleX(), w: st.width(), h: st.height() };
    });
    // The text's centre, (2020, 1005) studs, is on the view centre.
    expect((2020 * 8 * view.z + view.x) - view.w / 2).toBeCloseTo(0, 0);
    expect((1005 * 8 * view.z + view.y) - view.h / 2).toBeCloseTo(0, 0);
    // The 320 x 80 px box plus 100 px fits the width.
    expect(view.z).toBeCloseTo((view.w - 4) / 420, 2);
  });
});

test.describe('selection while snapping', () => {
  test('the dragged brick\'s outline turns green while a connection snap is live', async ({ page }) => {
    const id = await createLayout(page);
    await openEditor(page, id);
    await page.getByPlaceholder(/Fuzzy filter/).fill('2865.8');
    const tile = page.locator('aside li button[draggable="true"]').filter({ has: page.locator('img') }).first();
    const box = (await page.locator('.konvajs-content').first().boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const bricks = async () => ((await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text()).match(/<Brick id=/g) ?? []).length;
    // One straight, dragged 40 studs left, then a second at the view
    // centre: their facing ends are 24 studs apart, too far to snap.
    await tile.dblclick();
    await expect.poll(bricks).toBe(1);
    // Placing the first brick auto-fits the view; zoom out so the drags stay
    // on the canvas (a drop outside it deletes), and work in studs.
    const zoom = () =>
      page.evaluate(() => (window as unknown as { Konva: { stages: { scaleX: () => number }[] } }).Konva.stages[0]!.scaleX());
    await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) await page.keyboard.press('Control+-');
    await page.waitForTimeout(300);
    const studPx = 8 * (await zoom());
    expect(40 * studPx).toBeLessThan(box.width / 2 - 20);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 40 * studPx, cy, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await tile.dblclick();
    await expect.poll(bricks).toBe(2);

    const haloStrokes = () =>
      page.evaluate(() => {
        type Node = { getClassName: () => string; stroke: () => string; strokeWidth: () => number };
        const K = (window as unknown as { Konva: { stages: { find: (s: (n: Node) => boolean) => Node[] }[] } }).Konva;
        return K.stages
          .flatMap((st) => st.find((n: Node) => n.getClassName() === 'Rect' && n.strokeWidth() === 2.5))
          .map((r) => r.stroke());
      });
    // The new piece is selected; drag it left until its free end is half a
    // stud from the other's.
    await expect.poll(haloStrokes).toEqual(['#FFD700']);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 23.5 * studPx, cy, { steps: 16 });
    await expect.poll(haloStrokes).toEqual(['rgb(80,255,120)']);
    await page.mouse.up();
    await expect.poll(haloStrokes).toEqual(['#FFD700']);
  });
});
