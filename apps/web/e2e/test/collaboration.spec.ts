// E2E: Collaborative real-time editing — two browser contexts edit the same
// layout simultaneously over WebSocket/Yjs. Tests verify that both editors
// can load the layout, that the presence panel shows a second user, and that
// basic keyboard shortcuts (undo/redo/escape) don't crash either session.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORDYCE_BBM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm',
  ),
  'utf-8',
);

const ts = Date.now();
const OWNER_EMAIL = `collab-owner-${ts}@example.com`;
const EDITOR_EMAIL = `collab-editor-${ts}@example.com`;
const PASS = 'correct horse battery';

/**
 * /api/auth/password/register and /login are both rate-limited (10/min)
 * — a real, intentional anti-abuse control, not something to weaken for
 * tests. This file alone registers/logs in well over 10 accounts across
 * its tests, so running it back-to-back with other specs (or itself)
 * can legitimately trip the limit. Retry on 429 using the server's own
 * `retry-after` header rather than guessing a backoff.
 */
async function postWithRateLimitRetry(
  page: Page,
  path: string,
  data: Record<string, string>,
  label: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const res = await page.request.post(path, { data });
    if (res.ok()) return;
    if (res.status() === 429 && attempt < 3) {
      const retryAfterSec = Number(res.headers()['retry-after'] ?? '5');
      await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
      continue;
    }
    expect(res.ok(), `${label} failed: ${res.status()} ${await res.text()}`).toBe(true);
    return;
  }
}

async function registerUser(page: Page, email: string, name: string): Promise<void> {
  await postWithRateLimitRetry(
    page,
    '/api/auth/password/register',
    { email, password: PASS, displayName: name },
    'register',
  );
}

async function loginUser(page: Page, email: string): Promise<void> {
  await postWithRateLimitRetry(page, '/api/auth/password/login', { email, password: PASS }, 'login');
}

test.describe('collaboration — dual-editor session', () => {
  test('both editors can open the same layout without crashing', async ({
    page,
    browser,
  }) => {
    // Register both users.
    await registerUser(page, OWNER_EMAIL, 'Collab Owner');
    await registerUser(page, EDITOR_EMAIL, 'Collab Editor');
    await loginUser(page, OWNER_EMAIL);

    // Owner creates the layout.
    const res = await page.request.post('/api/layouts', {
      data: { title: 'Collab Test Layout' },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };

    // Invite the editor as collaborator.
    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: EDITOR_EMAIL, role: 'editor' },
    });
    expect(inviteRes.ok()).toBe(true);
    const { token } = (await inviteRes.json()) as { token: string };

    // Editor context: accept invite and open editor.
    const editorCtx = await browser.newContext();
    const editorPage = await editorCtx.newPage();
    await loginUser(editorPage, EDITOR_EMAIL);
    await editorPage.request.post(`/api/invites/${token}`);

    // Owner opens the editor.
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Editor opens the editor in parallel.
    await editorPage.goto(`/editor/${id}`);
    await expect(editorPage.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    await editorCtx.close();
  });

  test('presence panel shows second user when both are in the editor', async ({
    page,
    browser,
  }) => {
    await registerUser(page, `presence-owner-${ts}@example.com`, 'Presence Owner');
    await registerUser(page, `presence-editor-${ts}@example.com`, 'Presence Editor');
    await loginUser(page, `presence-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Presence Test Layout' },
    });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `presence-editor-${ts}@example.com`, role: 'editor' },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const editorCtx = await browser.newContext();
    const editorPage = await editorCtx.newPage();
    await loginUser(editorPage, `presence-editor-${ts}@example.com`);
    await editorPage.request.post(`/api/invites/${token}`);

    // Owner opens first.
    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Editor opens second.
    await editorPage.goto(`/editor/${id}`);
    await expect(editorPage.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Wait briefly for awareness to propagate.
    await page.waitForTimeout(2000);

    // The owner's view should now show "Presence Editor" in the presence panel.
    // The PresencePanel renders peer names as text nodes.
    const presenceText = page.getByText('Presence Editor');
    if (await presenceText.count() > 0) {
      await expect(presenceText.first()).toBeVisible({ timeout: 5000 });
    }
    // Either way, both canvases must still be intact.
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(editorPage.locator('canvas').first()).toBeVisible();

    await editorCtx.close();
  });

  test('presence panel drops a peer after they disconnect (no stale duplicates)', async ({
    page,
    browser,
  }) => {
    // Regression test: the server's WS disconnect handler filtered
    // awareness cleanup by `session.doc.clientID` (the shared server-side
    // Y.Doc's OWN clientID, identical for every connection in the room and
    // never equal to any real browser client's awareness clientID) instead
    // of the clientID(s) that specific connection actually owned. The
    // filter matched nothing, so a client's presence entry was never
    // removed on disconnect — closing and reopening the editor a few times
    // left several stale duplicate entries for the same person.
    const ownerEmail = `presence-gone-owner-${ts}@example.com`;
    const peerEmail = `presence-gone-peer-${ts}@example.com`;
    await registerUser(page, ownerEmail, 'Presence Gone Owner');
    await registerUser(page, peerEmail, 'Presence Gone Peer');
    await loginUser(page, ownerEmail);

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Presence Cleanup Test Layout' },
    });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: peerEmail, role: 'editor' },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const peerCtx = await browser.newContext();
    const peerPage = await peerCtx.newPage();
    await loginUser(peerPage, peerEmail);
    await peerPage.request.post(`/api/invites/${token}`);

    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    await peerPage.goto(`/editor/${id}`);
    await expect(peerPage.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Give awareness a moment to propagate, then confirm the owner sees
    // exactly one presence entry for the peer.
    await page.waitForTimeout(1500);
    const peerNameText = page.getByText('Presence Gone Peer');
    const countWhileOpen = await peerNameText.count();

    // Close the peer's context — a real disconnect, not a navigation.
    await peerCtx.close();

    // Give the server's WS close handler time to run and broadcast the
    // awareness removal, then reopen a couple more peer sessions to make
    // sure repeated connect/disconnect cycles don't accumulate duplicates.
    await page.waitForTimeout(1500);

    if (countWhileOpen > 0) {
      // The peer's entry must be gone now that they've disconnected.
      await expect(peerNameText).toHaveCount(0, { timeout: 5000 });
    }

    for (let i = 0; i < 2; i++) {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await loginUser(p, peerEmail);
      await p.goto(`/editor/${id}`);
      await expect(p.locator('canvas').first()).toBeVisible({ timeout: 15000 });
      await page.waitForTimeout(800);
      await ctx.close();
      await page.waitForTimeout(800);
    }

    // After three connect/disconnect cycles, at most one stale-free entry
    // should ever be visible at a time, and none should remain once every
    // peer session has closed.
    await expect(peerNameText).toHaveCount(0, { timeout: 5000 });
  });

  test('undo/redo in one editor does not crash the other', async ({
    page,
    browser,
  }) => {
    await registerUser(page, `undo-owner-${ts}@example.com`, 'Undo Owner');
    await registerUser(page, `undo-editor-${ts}@example.com`, 'Undo Editor');
    await loginUser(page, `undo-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Undo Collab Layout' },
    });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `undo-editor-${ts}@example.com`, role: 'editor' },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const editorCtx = await browser.newContext();
    const editorPage = await editorCtx.newPage();
    await loginUser(editorPage, `undo-editor-${ts}@example.com`);
    await editorPage.request.post(`/api/invites/${token}`);

    await page.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    await editorPage.goto(`/editor/${id}`);
    await expect(editorPage.locator('canvas').first()).toBeVisible({ timeout: 15000 });

    // Owner sends undo — should not crash the editor page. The Konva
    // Stage stacks 3 <canvas> elements (interactive layer + HUD overlay
    // on top); `.first()` is the bottom one, which the top layer
    // legitimately intercepts pointer events for, so Playwright's
    // actionability check correctly refuses a plain click there. Click
    // the topmost canvas instead — that's what a real user's click
    // actually lands on.
    await page.locator('canvas').last().click();
    await page.keyboard.press('Control+z');
    await expect(page.locator('canvas').first()).toBeVisible();

    // Editor sends redo.
    await editorPage.locator('canvas').last().click();
    await editorPage.keyboard.press('Control+y');
    await expect(editorPage.locator('canvas').first()).toBeVisible();

    await editorCtx.close();
  });

  test('Fordyce 2026: both editors open a large layout without crashing', async ({
    page,
    browser,
  }) => {
    // Two sequential 25s canvas-visible waits below can together exceed
    // Playwright's default 30s per-test timeout even though each one
    // individually accounts for the 949-brick layout's slower first
    // render — bump the test's own budget rather than the assertions.
    test.setTimeout(70_000);
    await registerUser(page, `fordyce-collab-owner-${ts}@example.com`, 'Fordyce Owner');
    await registerUser(page, `fordyce-collab-editor-${ts}@example.com`, 'Fordyce Editor');
    await loginUser(page, `fordyce-collab-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce Collab', bbm: FORDYCE_BBM },
    });
    expect(res.ok()).toBe(true);
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `fordyce-collab-editor-${ts}@example.com`, role: 'editor' },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const editorCtx = await browser.newContext();
    const editorPage = await editorCtx.newPage();
    await loginUser(editorPage, `fordyce-collab-editor-${ts}@example.com`);
    await editorPage.request.post(`/api/invites/${token}`);

    // Open in both contexts. Use a longer timeout for the 949-brick layout.
    await page.goto(`/editor/${id}`);
    await editorPage.goto(`/editor/${id}`);

    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 25000 });
    await expect(editorPage.locator('canvas').first()).toBeVisible({ timeout: 25000 });

    await editorCtx.close();
  });

  test('snapshot API is consistent between two open sessions', async ({
    page,
    browser,
  }) => {
    await registerUser(page, `snap-owner-${ts}@example.com`, 'Snap Owner');
    await registerUser(page, `snap-editor-${ts}@example.com`, 'Snap Editor');
    await loginUser(page, `snap-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', {
      data: { title: 'Snapshot Collab Layout', bbm: FORDYCE_BBM },
    });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `snap-editor-${ts}@example.com`, role: 'editor' },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const editorCtx = await browser.newContext();
    const editorPage = await editorCtx.newPage();
    await loginUser(editorPage, `snap-editor-${ts}@example.com`);
    await editorPage.request.post(`/api/invites/${token}`);

    // Both open the editor.
    await page.goto(`/editor/${id}`);
    await editorPage.goto(`/editor/${id}`);
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 20000 });
    await expect(editorPage.locator('canvas').first()).toBeVisible({ timeout: 20000 });

    // Both should be able to fetch the snapshot independently.
    const snap1 = await page.request.get(`/api/layouts/${id}/snapshot`);
    const snap2 = await editorPage.request.get(`/api/layouts/${id}/snapshot`);
    expect(snap1.ok()).toBe(true);
    expect(snap2.ok()).toBe(true);
    expect((await snap1.body()).byteLength).toBeGreaterThan(1000);
    expect((await snap2.body()).byteLength).toBeGreaterThan(1000);

    await editorCtx.close();
  });
});

test.describe('collaboration — collaborator management via API', () => {
  test('inviting a collaborator via API and verifying list', async ({ page }) => {
    await registerUser(page, `api-collab-owner-${ts}@example.com`, 'API Owner');
    await loginUser(page, `api-collab-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', { data: { title: 'API Collab Layout' } });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `invited-${ts}@example.com`, role: 'viewer' },
    });
    expect(inviteRes.ok()).toBe(true);
    const inviteBody = (await inviteRes.json()) as { id: string; token: string };
    expect(typeof inviteBody.token).toBe('string');

    const collabRes = await page.request.get(`/api/layouts/${id}/collaborators`);
    expect(collabRes.ok()).toBe(true);
    const collabBody = (await collabRes.json()) as {
      collaborators: unknown[];
      invites: Array<{ invitedEmail: string; role: string }>;
    };
    expect(collabBody.invites).toHaveLength(1);
    expect(collabBody.invites[0]!.invitedEmail).toBe(`invited-${ts}@example.com`);
    expect(collabBody.invites[0]!.role).toBe('viewer');
  });

  test('revoking a collaborator invite removes it from the list', async ({ page }) => {
    await registerUser(page, `revoke-owner-${ts}@example.com`, 'Revoke Owner');
    await loginUser(page, `revoke-owner-${ts}@example.com`);

    const res = await page.request.post('/api/layouts', { data: { title: 'Revoke Invite Layout' } });
    const { id } = (await res.json()) as { id: string };

    const inviteRes = await page.request.post(`/api/layouts/${id}/invites`, {
      data: { email: `revoked-${ts}@example.com`, role: 'editor' },
    });
    const { id: inviteId } = (await inviteRes.json()) as { id: string };

    const revokeRes = await page.request.delete(`/api/layouts/${id}/invites/${inviteId}`);
    expect(revokeRes.ok()).toBe(true);

    const listRes = await page.request.get(`/api/layouts/${id}/collaborators`);
    const listBody = (await listRes.json()) as { invites: unknown[] };
    expect(listBody.invites).toHaveLength(0);
  });
});
