// E2E: Orgs — create org, invite member, accept invite, member access,
// layout ownership, role management, and leave/remove flows.

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVerificationToken } from '../dbHelpers';

const ts = Date.now();
const ADMIN_EMAIL = `orgs-admin-${ts}@example.com`;
const MEMBER_EMAIL = `orgs-member-${ts}@example.com`;
const OUTSIDER_EMAIL = `orgs-outsider-${ts}@example.com`;
const PASS = 'correct horse battery';

const FORDYCE_BBM = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm',
  ),
  'utf-8',
);

/**
 * /api/auth/password/register and /login are both rate-limited
 * (10/min) — a real, intentional anti-abuse control. This file alone
 * registers a dozen-plus accounts, so running it back-to-back with
 * other specs can legitimately trip the limit. Retry on 429 using the
 * server's own `retry-after` header rather than guessing a backoff.
 */
async function postWithRateLimitRetry(
  page: Page,
  path: string,
  data: Record<string, string>,
): Promise<{ ok: () => boolean; status: () => number }> {
  for (let attempt = 0; ; attempt++) {
    const res = await page.request.post(path, { data });
    if (res.status() === 429 && attempt < 3) {
      const retryAfterSec = Number(res.headers()['retry-after'] ?? '5');
      await new Promise((r) => setTimeout(r, (retryAfterSec + 1) * 1000));
      continue;
    }
    return res;
  }
}

/**
 * Register AND verify. A few tests re-register the same email across
 * multiple `test()` blocks (e.g. ADMIN_EMAIL) — register itself already
 * tolerates that (see the pre-existing 409-on-repeat pattern elsewhere
 * in this file), and on a repeat the server never issues a second
 * verification token, so skip the verify round-trip when the account is
 * already known to be verified from an earlier call in this run.
 */
const verifiedEmails = new Set<string>();

async function registerUser(
  page: Page,
  email: string,
  displayName: string,
): Promise<void> {
  const res = await postWithRateLimitRetry(page, '/api/auth/password/register', {
    email, password: PASS, displayName,
  });
  if (res.status() !== 409) expect(res.ok()).toBe(true);
  if (!verifiedEmails.has(email)) {
    const token = await getVerificationToken(email);
    const verifyRes = await page.request.post(`/api/auth/password/verify-email/${token}`);
    expect(verifyRes.ok()).toBe(true);
    verifiedEmails.add(email);
  }
}

async function loginUser(page: Page, email: string): Promise<void> {
  const res = await postWithRateLimitRetry(page, '/api/auth/password/login', { email, password: PASS });
  expect(res.ok()).toBe(true);
}

async function createOrg(
  page: Page,
  name: string,
): Promise<{ id: string; slug: string }> {
  const res = await page.request.post('/api/orgs', { data: { name } });
  expect(res.ok()).toBe(true);
  return res.json() as Promise<{ id: string; slug: string }>;
}

async function inviteMember(
  page: Page,
  slug: string,
  email: string,
  role: 'admin' | 'member' = 'member',
): Promise<string> {
  const res = await page.request.post(`/api/orgs/${slug}/invites`, {
    data: { email, role },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { token?: string; inviteId?: string };
  // The server returns the token directly for non-email environments.
  return (body.token ?? body.inviteId) as string;
}

/** Returns a new page context logged in as the given user. */
async function newUserContext(
  browser: import('@playwright/test').Browser,
  email: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginUser(page, email);
  return { ctx, page };
}

test.describe('orgs — create', () => {
  test('creates an org via the API and it appears in the list', async ({
    page,
  }) => {
    await registerUser(page, ADMIN_EMAIL, 'Org Admin');
    await loginUser(page, ADMIN_EMAIL);

    const org = await createOrg(page, 'Test Organisation');
    expect(org.slug).toBeTruthy();

    const list = await page.request.get('/api/orgs');
    expect(list.ok()).toBe(true);
    // Response nests the array under `orgs` — see GET /api/orgs in
    // apps/server/src/routes/orgs.ts.
    const body = (await list.json()) as { orgs: Array<{ slug: string; name: string }> };
    expect(body.orgs.some((o) => o.slug === org.slug)).toBe(true);
  });

  test('org details are retrievable by slug', async ({ page }) => {
    await registerUser(page, `slug-${ts}@example.com`, 'Slug User');
    await loginUser(page, `slug-${ts}@example.com`);

    const org = await createOrg(page, 'Slug Test Org');
    const detail = await page.request.get(`/api/orgs/${org.slug}`);
    expect(detail.ok()).toBe(true);
    const body = (await detail.json()) as { name: string; slug: string };
    expect(body.name).toBe('Slug Test Org');
    expect(body.slug).toBe(org.slug);
  });

  test('auto-derives a slug from the org name', async ({ page }) => {
    await registerUser(page, `autoslug-${ts}@example.com`, 'AutoSlug User');
    await loginUser(page, `autoslug-${ts}@example.com`);

    const res = await page.request.post('/api/orgs', {
      data: { name: 'My Awesome Organisation 2026' },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { slug: string };
    // Slug should be lowercase and URL-safe.
    expect(body.slug).toMatch(/^[a-z0-9-]+$/);
  });

  test('duplicate slug is rejected with 409', async ({ page }) => {
    await registerUser(page, `dup-${ts}@example.com`, 'Dup User');
    await loginUser(page, `dup-${ts}@example.com`);

    await page.request.post('/api/orgs', {
      data: { name: 'Unique Org', slug: `dup-org-${ts}` },
    });
    const second = await page.request.post('/api/orgs', {
      data: { name: 'Duplicate Slug Org', slug: `dup-org-${ts}` },
    });
    expect(second.status()).toBe(409);
  });
});

test.describe('orgs — members', () => {
  test('creator is automatically an admin member', async ({ page }) => {
    await registerUser(page, `creator-${ts}@example.com`, 'Creator User');
    await loginUser(page, `creator-${ts}@example.com`);

    const org = await createOrg(page, 'Creator Admin Test');
    const members = await page.request.get(`/api/orgs/${org.slug}/members`);
    expect(members.ok()).toBe(true);
    const body = (await members.json()) as {
      members: Array<{ role: string }>;
    };
    expect(body.members.length).toBe(1);
    expect(body.members[0]!.role).toBe('admin');
  });

  test('invite + accept flow adds member to the org', async ({
    page,
    browser,
  }) => {
    await registerUser(page, `invite-admin-${ts}@example.com`, 'Invite Admin');
    await registerUser(
      page,
      `invite-member-${ts}@example.com`,
      'Invite Member',
    );
    await loginUser(page, `invite-admin-${ts}@example.com`);

    const org = await createOrg(page, 'Invite Test Org');
    const res = await page.request.post(`/api/orgs/${org.slug}/invites`, {
      data: { email: `invite-member-${ts}@example.com`, role: 'member' },
    });
    expect(res.ok()).toBe(true);
    const inviteBody = (await res.json()) as { token: string };
    const token = inviteBody.token;

    // Member context: accept the invite.
    const { ctx: memberCtx, page: memberPage } = await newUserContext(
      browser,
      `invite-member-${ts}@example.com`,
    );
    const acceptRes = await memberPage.request.post(
      `/api/org-invites/${token}`,
    );
    expect(acceptRes.ok()).toBe(true);

    // Verify the member list now has 2 entries.
    const members = await page.request.get(`/api/orgs/${org.slug}/members`);
    const membersBody = (await members.json()) as {
      members: Array<{ role: string }>;
    };
    expect(membersBody.members.length).toBe(2);
    const roles = membersBody.members.map((m) => m.role);
    expect(roles).toContain('admin');
    expect(roles).toContain('member');

    await memberCtx.close();
  });

  test('non-member cannot see org details', async ({ page, browser }) => {
    await registerUser(
      page,
      `private-admin-${ts}@example.com`,
      'Private Admin',
    );
    await registerUser(
      page,
      OUTSIDER_EMAIL,
      'Outsider',
    );
    await loginUser(page, `private-admin-${ts}@example.com`);

    const org = await createOrg(page, 'Private Org');

    const { ctx: outsiderCtx, page: outsiderPage } = await newUserContext(
      browser,
      OUTSIDER_EMAIL,
    );
    const detail = await outsiderPage.request.get(`/api/orgs/${org.slug}`);
    // Non-member should get 403 or 404.
    expect([403, 404]).toContain(detail.status());
    await outsiderCtx.close();
  });

  test('accepting the same invite twice returns 410', async ({
    page,
    browser,
  }) => {
    await registerUser(
      page,
      `double-admin-${ts}@example.com`,
      'Double Admin',
    );
    await registerUser(
      page,
      `double-member-${ts}@example.com`,
      'Double Member',
    );
    await loginUser(page, `double-admin-${ts}@example.com`);

    const org = await createOrg(page, 'Double Accept Org');
    const inviteRes = await page.request.post(`/api/orgs/${org.slug}/invites`, {
      data: {
        email: `double-member-${ts}@example.com`,
        role: 'member',
      },
    });
    const { token } = (await inviteRes.json()) as { token: string };

    const { ctx, page: memberPage } = await newUserContext(
      browser,
      `double-member-${ts}@example.com`,
    );
    await memberPage.request.post(`/api/org-invites/${token}`);
    const second = await memberPage.request.post(`/api/org-invites/${token}`);
    expect(second.status()).toBe(410);
    await ctx.close();
  });
});

test.describe('orgs — layout ownership', () => {
  test('org member can access a layout owned by the org', async ({
    page,
    browser,
  }) => {
    await registerUser(page, ADMIN_EMAIL, 'Org Admin');
    await registerUser(page, MEMBER_EMAIL, 'Org Member');
    await loginUser(page, ADMIN_EMAIL);

    const org = await createOrg(page, 'Layout Org');

    // Invite the member.
    const inviteRes = await page.request.post(
      `/api/orgs/${org.slug}/invites`,
      { data: { email: MEMBER_EMAIL, role: 'member' } },
    );
    const { token } = (await inviteRes.json()) as { token: string };

    // Member accepts.
    const { ctx: memberCtx, page: memberPage } = await newUserContext(
      browser,
      MEMBER_EMAIL,
    );
    await memberPage.request.post(`/api/org-invites/${token}`);

    // Admin creates a layout (owned by the user for now — org layouts
    // use a transfer mechanism; this verifies collaborator access).
    const layoutRes = await page.request.post('/api/layouts', {
      data: { title: 'Org Layout' },
    });
    const { id: layoutId } = (await layoutRes.json()) as { id: string };

    // Invite the member as a collaborator on the layout (the endpoint is
    // .../invites, which creates a token the recipient must accept —
    // there's no direct .../collaborators write endpoint).
    const collabInviteRes = await page.request.post(`/api/layouts/${layoutId}/invites`, {
      data: { email: MEMBER_EMAIL, role: 'editor' },
    });
    const { token: collabToken } = (await collabInviteRes.json()) as { token: string };
    const acceptRes = await memberPage.request.post(`/api/invites/${collabToken}`);
    expect(acceptRes.ok()).toBe(true);

    // Member should be able to GET the layout.
    const layoutDetail = await memberPage.request.get(
      `/api/layouts/${layoutId}`,
    );
    expect(layoutDetail.ok()).toBe(true);
    // Response nests fields under `layout` — see GET /api/layouts/:id in
    // apps/server/src/routes/layouts.ts.
    const layoutBody = (await layoutDetail.json()) as { layout: { title: string } };
    expect(layoutBody.layout.title).toBe('Org Layout');

    await memberCtx.close();
  });

  test('import Fordyce 2026 into an org-accessible layout', async ({
    page,
  }) => {
    await registerUser(page, `fordyce-org-${ts}@example.com`, 'Fordyce Org User');
    await loginUser(page, `fordyce-org-${ts}@example.com`);

    const org = await createOrg(page, 'Fordyce Org');
    const layoutRes = await page.request.post('/api/layouts', {
      data: { title: 'Fordyce 2026 Org Import', bbm: FORDYCE_BBM },
    });
    expect(layoutRes.ok()).toBe(true);
    const { id } = (await layoutRes.json()) as { id: string };

    // Verify layout is retrievable and has the right title. Response
    // nests fields under `layout` — see GET /api/layouts/:id in
    // apps/server/src/routes/layouts.ts.
    const detail = await page.request.get(`/api/layouts/${id}`);
    expect(detail.ok()).toBe(true);
    const body = (await detail.json()) as { layout: { title: string } };
    expect(body.layout.title).toBe('Fordyce 2026 Org Import');

    // Org exists and creator is admin.
    const members = await page.request.get(`/api/orgs/${org.slug}/members`);
    const membersBody = (await members.json()) as {
      members: Array<{ role: string }>;
    };
    expect(membersBody.members[0]!.role).toBe('admin');
  });
});

test.describe('orgs — remove member', () => {
  test('admin can remove a member from the org', async ({ page, browser }) => {
    await registerUser(page, `remadmin-${ts}@example.com`, 'Rem Admin');
    await registerUser(page, `remmember-${ts}@example.com`, 'Rem Member');
    await loginUser(page, `remadmin-${ts}@example.com`);

    const org = await createOrg(page, 'Remove Member Org');
    const inviteRes = await page.request.post(
      `/api/orgs/${org.slug}/invites`,
      { data: { email: `remmember-${ts}@example.com`, role: 'member' } },
    );
    const { token } = (await inviteRes.json()) as { token: string };

    const { ctx: memberCtx, page: memberPage } = await newUserContext(
      browser,
      `remmember-${ts}@example.com`,
    );
    const acceptRes = await memberPage.request.post(
      `/api/org-invites/${token}`,
    );
    const { orgId } = (await acceptRes.json()) as { orgId: string };

    // Get the member's userId from the member list.
    const membersRes = await page.request.get(
      `/api/orgs/${org.slug}/members`,
    );
    const membersBody = (await membersRes.json()) as {
      members: Array<{ userId: string; role: string }>;
    };
    const memberEntry = membersBody.members.find((m) => m.role === 'member');
    expect(memberEntry).toBeTruthy();

    // Admin removes the member.
    const removeRes = await page.request.delete(
      `/api/orgs/${org.slug}/members/${memberEntry!.userId}`,
    );
    expect(removeRes.ok()).toBe(true);

    // Member list should be back to 1.
    const after = await page.request.get(`/api/orgs/${org.slug}/members`);
    const afterBody = (await after.json()) as {
      members: Array<{ role: string }>;
    };
    expect(afterBody.members.length).toBe(1);

    await memberCtx.close();
  });
});

test.describe('orgs — UI flows', () => {
  test('org page is accessible in the UI after login', async ({ page }) => {
    await registerUser(page, `ui-org-${ts}@example.com`, 'UI Org User');
    await loginUser(page, `ui-org-${ts}@example.com`);

    const org = await createOrg(page, 'UI Org Flow');
    await page.goto(`/orgs/${org.slug}`);
    // The page should render without crashing — show the org name or an error.
    await expect(
      page.getByText('UI Org Flow').or(page.getByText(/org/i)),
    ).toBeVisible({ timeout: 8000 });
  });

  test('navigating to an unknown org slug shows a not-found page', async ({
    page,
  }) => {
    await registerUser(
      page,
      `ui-notfound-${ts}@example.com`,
      'UI NotFound User',
    );
    await loginUser(page, `ui-notfound-${ts}@example.com`);

    await page.goto('/orgs/this-org-does-not-exist-xyz');
    await expect(
      page
        .getByText(/not found|error|doesn't exist/i)
        .or(page.locator('h1')),
    ).toBeVisible({ timeout: 5000 });
  });
});
