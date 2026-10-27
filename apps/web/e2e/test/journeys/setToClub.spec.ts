// Journey — moving a set made of your own custom parts to a club.
//
//   Sam has two custom parts, a set "Yard" of both, and a set "Depot" that
//   also uses one of them → Move or copy… ▸ Move to a club on the yard lists
//   the part that moves with it, and the one that stays his (the depot uses
//   it) while the club gets a copy → Move → Ada, in the club, sees the set
//   and both parts it needs, live → Sam's depot still has its part.

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { signIn } from '../../helpers';

const ts = Date.now();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const XML = Buffer.from('<?xml version="1.0"?><part><Author>e2e</Author></part>').toString('base64');
const SHED = `SHED${ts}`;
const LAMP = `LAMP${ts}`;
const YARD = `Yard${ts}`;
const DEPOT = `Depot${ts}`;
const setXml = (name: string, ids: string[]) =>
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<group>\n\t<Description><en>${name}</en></Description>\n\t<SubPartList>\n` +
      ids.map((id, i) => `\t\t<SubPart id="${id}"><position><x>${i * 8}</x><y>0</y></position><angle>0</angle></SubPart>\n`).join('') +
      '\t</SubPartList>\n</group>\n',
  ).toString('base64');

async function browserFor(browser: Browser, email: string, name: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, email, name);
  return { ctx, page };
}

interface Listed {
  id: string;
  partNumber: string;
  ownerOrgId: string | null;
  ownerUserId: string | null;
}

test('moving a set to a club brings the custom parts in it', async ({ browser }) => {
  test.setTimeout(180_000);
  const ada = await browserFor(browser, `j-setclub-ada-${ts}@example.com`, 'Ada');
  const sam = await browserFor(browser, `j-setclub-sam-${ts}@example.com`, 'Sam');
  try {
    const CLUB = `Rail Club ${ts}`;
    const club = (await (await ada.page.request.post('/api/orgs', { data: { name: CLUB } })).json()) as { id: string; slug: string };
    expect((await ada.page.request.patch(`/api/orgs/${club.slug}`, { data: { joinPolicy: 'open', listed: true } })).ok()).toBe(true);
    expect((await sam.page.request.post(`/api/orgs/${club.slug}/join`, { data: {} })).ok()).toBe(true);
    for (const [partNumber, displayName] of [
      [SHED, 'Engine shed'],
      [LAMP, 'Yard lamp'],
    ]) {
      const r = await sam.page.request.post('/api/custom-parts', { data: { partNumber, displayName, xmlBase64: XML, spriteBase64: PNG, spriteMime: 'image/png' } });
      expect(r.status()).toBe(201);
    }
    for (const [name, ids] of [
      [YARD, [SHED, LAMP, '3001.1']],
      [DEPOT, [LAMP]],
    ] as const) {
      const r = await sam.page.request.post('/api/custom-parts', { data: { partNumber: name, displayName: name, xmlBase64: setXml(name, [...ids]) } });
      expect(r.status()).toBe(201);
    }

    await ada.page.goto('/#parts');
    await expect(ada.page.locator('html')).toHaveAttribute('data-live', 'open', { timeout: 15000 });
    await sam.page.goto('/#parts');

    // ── The move dialog lists what happens to the parts in the yard. ──
    await sam.page.getByRole('button', { name: `More for ${YARD}` }).click();
    await sam.page.getByRole('menuitem', { name: 'Move or copy…' }).click();
    await sam.page.getByLabel(/Move to a club/).check();
    const box = sam.page.getByTestId('set-move-parts');
    await expect(box).toContainText('This custom part of yours moves with the set:');
    await expect(box).toContainText(`Engine shed (${SHED})`);
    await expect(box).toContainText('These stay yours, because another of your sets uses them. The club gets its own copy:');
    await expect(box).toContainText(`Yard lamp (${LAMP})`);
    await expect(box.getByRole('button', { name: /help/i })).toBeVisible();
    await sam.page.getByRole('button', { name: 'Move', exact: true }).click();
    await sam.page.getByTestId('confirm-dialog').getByRole('button', { name: 'Move' }).click();
    await expect(sam.page.getByText(`Moved “${YARD}” and 1 of your parts in it to ${CLUB}.`)).toBeVisible();

    // ── Ada, in the club, has the set and both its parts, without a reload. ──
    await expect(ada.page.getByRole('button', { name: `More for ${YARD}` })).toBeVisible({ timeout: 15000 });
    await expect(ada.page.getByRole('button', { name: `More for ${SHED}` })).toBeVisible({ timeout: 15000 });
    await expect(ada.page.getByRole('button', { name: `More for ${LAMP}` })).toBeVisible({ timeout: 15000 });
    const adas = ((await (await ada.page.request.get('/api/custom-parts')).json()) as { parts: Listed[] }).parts;
    for (const n of [YARD, SHED, LAMP]) expect(adas.find((p) => p.partNumber === n)?.ownerOrgId).toBe(club.id);

    // ── Sam's depot keeps its lamp: his own, still. ──
    const sams = ((await (await sam.page.request.get('/api/custom-parts?owner=me')).json()) as { parts: Listed[] }).parts.map((p) => p.partNumber);
    expect(sams).toEqual(expect.arrayContaining([DEPOT, LAMP]));
    expect(sams).not.toContain(YARD);
    expect(sams).not.toContain(SHED);
  } finally {
    await ada.ctx.close();
    await sam.ctx.close();
  }
});
