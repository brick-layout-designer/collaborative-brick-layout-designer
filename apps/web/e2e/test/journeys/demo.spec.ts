// Journey — the demo account.
//
//   1. An admin turns on Admin › Settings › Demo account; "Try the demo"
//      appears on the sign-in page (it isn't there while the demo is off).
//   2. A visitor tries the demo: no sign-up, a banner says it resets, and
//      the sample layout is there. They add a part to it and make a layout
//      of their own.
//   3. The admin presses Reset now. The visitor's Home updates without a
//      reload: their layout is gone and the sample is back, unedited.
//   4. Turning the demo off signs the visitor out and hides Try the demo.

import { test, expect, type Page } from '@playwright/test';
import { signIn } from '../../helpers';
import { makeGlobalAdmin } from '../../dbHelpers';

const ts = Date.now();
const ADMIN = `j-demo-admin-${ts}@example.com`;
const PART = 'ts_narrowgauge_straight.8';
const SAMPLE = 'Sample layout';

function brickCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    type N = { name: () => string; getClassName: () => string };
    const st = (window as unknown as { Konva?: { stages: { find: (f: (n: N) => boolean) => N[] }[] } }).Konva?.stages[0];
    return st ? st.find((n) => n.getClassName() === 'Group' && n.name().startsWith('brick-')).length : 0;
  });
}

/** The visitor's layouts, from the server. */
async function myLayouts(page: Page): Promise<{ id: string; title: string }[]> {
  const res = await page.request.get('/api/layouts');
  return ((await res.json()) as { layouts: { id: string; title: string }[] }).layouts;
}

/** How many parts the server has for a layout (its .bbm export). */
async function savedBricks(page: Page, id: string): Promise<number> {
  const bbm = await (await page.request.get(`/api/layouts/${id}/export.bbm`)).text();
  return bbm.split('<Brick ').length - 1;
}

test('an admin turns on the demo, a visitor tries it, and Reset now puts the sample back live', async ({ page: admin, browser }) => {
  test.setTimeout(240_000);
  await signIn(admin, ADMIN, 'Demo Admin');
  makeGlobalAdmin(ADMIN);
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();

  // Off: the sign-in page has no Try the demo.
  await visitor.goto('/login');
  await expect(visitor.getByRole('heading', { name: /Sign in/ })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Try the demo' })).toHaveCount(0);

  try {
    // ── 1. The admin turns it on. ──
    await admin.goto('/admin');
    await admin.getByRole('button', { name: 'settings', exact: true }).click();
    const enable = admin.getByLabel('Enable the demo account');
    await expect(enable).not.toBeChecked();
    await enable.click(); // saved, then shown from the server
    await expect(enable).toBeChecked();
    await expect(admin.getByLabel('Daily')).toBeChecked();
    await expect(admin.getByRole('button', { name: 'Reset now' })).toBeEnabled();
    await expect(admin.getByTestId('demo-last-reset')).toContainText('Last reset');
    await expect(admin.getByTestId('demo-last-reset')).toContainText('3 things in it now');

    // ── 2. A visitor tries it. ──
    await visitor.goto('/login');
    await visitor.getByRole('button', { name: 'Try the demo' }).click();
    await expect(visitor.getByTestId('demo-banner')).toContainText(/This is a demo\. Everything resets every day \(next reset in \d+ h( \d+ min)?\)\./);
    await expect(visitor.getByText(SAMPLE, { exact: true }).first()).toBeVisible();
    const [sample] = await myLayouts(visitor);
    expect(sample!.title).toBe(SAMPLE);
    const original = await savedBricks(visitor, sample!.id);
    expect(original).toBeGreaterThan(100);

    // They add a part to the sample in the editor, and it saves.
    await visitor.goto(`/editor/${sample!.id}`);
    await expect(visitor.locator('canvas').first()).toBeVisible({ timeout: 15000 });
    await expect.poll(() => brickCount(visitor), { timeout: 15000 }).toBe(original);
    await visitor.getByPlaceholder(/fuzzy filter/i).first().fill('narrow gauge track straight 4 x 16');
    await visitor.locator(`[title*="(${PART})"]`).first().dblclick();
    await expect.poll(() => brickCount(visitor)).toBe(original + 1);
    await expect.poll(() => savedBricks(visitor, sample!.id), { timeout: 15000 }).toBe(original + 1);

    // …and a layout of their own, then go Home.
    expect((await visitor.request.post('/api/layouts', { data: { title: `Visitor layout ${ts}` } })).ok()).toBe(true);
    await visitor.goto('/');
    await expect(visitor.getByText(`Visitor layout ${ts}`)).toBeVisible();
    await expect(visitor.locator('html')).toHaveAttribute('data-live', 'open', { timeout: 15000 });
    // Marks this page load: a reload would lose it.
    await visitor.evaluate(() => ((window as unknown as { __sameLoad: boolean }).__sameLoad = true));

    // ── 3. The admin resets it; the visitor's Home updates live. ──
    const lastBefore = await admin.getByTestId('demo-last-reset').textContent();
    await admin.getByRole('button', { name: 'Reset now' }).click();
    await expect(visitor.getByText(`Visitor layout ${ts}`)).toHaveCount(0, { timeout: 15000 });
    await expect(visitor.getByText(SAMPLE, { exact: true }).first()).toBeVisible();
    expect(await visitor.evaluate(() => (window as unknown as { __sameLoad?: boolean }).__sameLoad)).toBe(true);
    await expect(admin.getByTestId('demo-last-reset')).not.toHaveText(lastBefore ?? '');

    // The sample is back as it was: a fresh copy, without the added part.
    const after = await myLayouts(visitor);
    expect(after.map((l) => l.title)).toEqual([SAMPLE]);
    expect(after[0]!.id).not.toBe(sample!.id);
    expect(await savedBricks(visitor, after[0]!.id)).toBe(original);

    // The demo can't share: the server says so in plain words.
    const share = await visitor.request.post(`/api/layouts/${after[0]!.id}/public-share`);
    expect(share.status()).toBe(403);
    // …and the pages don't offer what it would refuse: Share… says why and
    // keeps only the picture; Clubs explains instead of a failing Ask to join.
    await visitor.getByRole('button', { name: `More for ${SAMPLE}` }).click();
    await visitor.getByRole('menuitem', { name: 'Share…' }).click();
    const dialog = visitor.getByRole('dialog', { name: `Share ${SAMPLE}` });
    await expect(dialog).toContainText('The demo account can’t invite people or make a share link.');
    await expect(dialog.getByPlaceholder(/email/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await visitor.goto('/orgs');
    await expect(visitor.getByText(/The demo account can’t make or join clubs\./)).toBeVisible();
  } finally {
    // ── 4. Off again (the journeys share one server). ──
    await admin.request.patch('/api/admin/settings', { data: { demoEnabled: false } });
  }
  const me = (await (await visitor.request.get('/api/auth/me')).json()) as { user: unknown };
  expect(me.user).toBeNull();
  await visitor.goto('/login');
  await expect(visitor.getByRole('heading', { name: /Sign in/ })).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Try the demo' })).toHaveCount(0);
  await visitorCtx.close();
});
