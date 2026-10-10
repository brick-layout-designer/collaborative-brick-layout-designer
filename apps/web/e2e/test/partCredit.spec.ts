// An imported model's builder is credited (Aaron, 2026-10-08): the part's
// <Designer> reaches the parts list, and a layout download names the part
// by its number, not the website's "custom:<id>".

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn } from '../helpers';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('the designer credit reaches the parts list, and downloads name the part', async ({ page }) => {
  const ts = Date.now();
  await signIn(page, `credit-${ts}@example.com`, 'Credit');
  const xml = Buffer.from(
    '<?xml version="1.0"?><part><Author>me</Author><Designer url="https://example.com/sam">Sam Builder</Designer><ImportSource><SourcePath>/home/me/model.io</SourcePath></ImportSource></part>',
  ).toString('base64');
  const up = await page.request.post('/api/custom-parts', {
    data: { partNumber: `MKT${ts}`, displayName: `Market ${ts}`, xmlBase64: xml, spriteBase64: PNG, spriteMime: 'image/png' },
  });
  expect(up.ok()).toBe(true);
  const { id: partId } = (await up.json()) as { id: string };

  const catalog = (await (await page.request.get('/api/parts/catalog')).json()) as { parts: { key: string; designer?: { name: string; url?: string } }[] };
  const mine = catalog.parts.find((p) => p.key === `custom:${partId}`);
  expect(mine?.designer).toEqual({ name: 'Sam Builder', url: 'https://example.com/sam' });

  // A layout using it, the way the website places it ("custom:<id>").
  const bbm = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/tight-corner.bbm'), 'utf8')
    .replace(/<PartNumber>[^<]*<\/PartNumber>/, `<PartNumber>custom:${partId}</PartNumber>`);
  const created = await page.request.post('/api/layouts', { data: { title: 'Credit', bbm } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  const out = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
  expect(out).toContain(`MKT${ts}`);
  expect(out).not.toMatch(/custom:/i);
});
