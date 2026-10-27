// Journey — sharing a set made of your own custom parts.
//
//   Sam has a custom part and a set that uses it → Share with people… on
//   the set says the part comes along → Sam invites Bea → Bea's invite page
//   lists the part, she accepts, and has the set and the part → Sam takes
//   the set back from Bea → the part goes from her parts too, live.

import { test, expect } from '@playwright/test';
import { ensureUser, signIn } from '../../helpers';

const ts = Date.now();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const XML = Buffer.from('<?xml version="1.0"?><part><Author>e2e</Author></part>').toString('base64');
const PART = `SHED${ts}`;
const SET = `Yard${ts}`;
const setXml = Buffer.from(
  `<?xml version="1.0" encoding="utf-8"?>\n<group>\n\t<Description><en>${SET}</en></Description>\n\t<SubPartList>\n` +
    `\t\t<SubPart id="${PART}"><position><x>0</x><y>0</y></position><angle>0</angle></SubPart>\n` +
    `\t\t<SubPart id="3001.1"><position><x>8</x><y>0</y></position><angle>0</angle></SubPart>\n` +
    '\t</SubPartList>\n</group>\n',
).toString('base64');

test('a shared set brings its custom parts, and taking it back takes them back', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const beaEmail = `j-setshare-bea-${ts}@example.com`;
  await ensureUser(beaEmail, 'Bea Builder');
  await signIn(page, `j-setshare-sam-${ts}@example.com`, 'Sam Sharer');
  const part = (await (await page.request.post('/api/custom-parts', {
    data: { partNumber: PART, displayName: 'Engine shed', xmlBase64: XML, spriteBase64: PNG, spriteMime: 'image/png' },
  })).json()) as { id: string };
  const set = await page.request.post('/api/custom-parts', { data: { partNumber: SET, displayName: SET, xmlBase64: setXml } });
  expect(set.status()).toBe(201);

  // ── The share dialog says which part comes along. ──
  await page.goto('/#parts');
  await page.getByRole('button', { name: `More for ${SET}` }).click();
  await page.getByRole('menuitem', { name: 'Share with people…' }).click();
  const share = page.getByRole('dialog', { name: `Share ${SET}` });
  const along = share.getByTestId('set-parts-come-along');
  await expect(along).toContainText('This custom part of yours comes along with the set');
  await expect(along).toContainText(`Engine shed (${PART})`);
  await share.getByPlaceholder('alice@example.com').fill(beaEmail);
  await share.getByRole('button', { name: 'Invite' }).click();
  const sent = share.getByRole('status');
  await expect(sent).toContainText('/part-invite/');
  const invitePath = /\/part-invite\/[0-9a-f]+/.exec((await sent.textContent()) ?? '')![0];

  // ── Bea's invite page lists the part; accepting gives her both. ──
  const ctx = await browser.newContext();
  const bea = await ctx.newPage();
  await signIn(bea, beaEmail, 'Bea Builder');
  const beaParts = async () => ((await (await bea.request.get('/api/custom-parts')).json()) as { parts: { id: string; partNumber: string }[] }).parts.map((p) => p.partNumber);
  expect(await beaParts()).not.toContain(PART);
  await bea.goto(invitePath);
  await expect(bea.getByText('You have the set and its part! Opening your parts…')).toBeVisible({ timeout: 15000 });
  await expect(bea).toHaveURL(/#parts$/, { timeout: 15000 });
  await expect(bea.getByRole('button', { name: `More for ${PART}` })).toBeVisible();
  await expect(bea.getByRole('button', { name: `More for ${SET}` })).toBeVisible();
  expect(await beaParts()).toEqual(expect.arrayContaining([PART, SET]));

  // ── Sam sees how Bea has the part: with the set. ──
  await page.reload();
  await page.getByRole('button', { name: `More for ${PART}` }).click();
  await page.getByRole('menuitem', { name: 'Share with people…' }).click();
  const partShare = page.getByRole('dialog', { name: 'Share Engine shed' });
  await expect(partShare.getByTestId('part-people')).toContainText(`With the set “${SET}”`);
  await partShare.getByRole('button', { name: 'Close' }).click();

  // ── Sam takes the set back: the part leaves Bea's parts too, without a reload. ──
  await page.getByRole('button', { name: `More for ${SET}` }).click();
  await page.getByRole('menuitem', { name: 'Share with people…' }).click();
  const again = page.getByRole('dialog', { name: `Share ${SET}` });
  await again.getByTestId('part-people').getByRole('button', { name: 'Remove' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button').last().click();
  await expect(again.getByTestId('part-people')).toContainText('Not shared with anyone yet.');
  await expect(bea.getByRole('button', { name: `More for ${SET}` })).toHaveCount(0, { timeout: 15000 });
  await expect(bea.getByRole('button', { name: `More for ${PART}` })).toHaveCount(0, { timeout: 15000 });
  expect(await beaParts()).not.toContain(PART);
  expect(part.id).toBeTruthy();
  await ctx.close();
});
