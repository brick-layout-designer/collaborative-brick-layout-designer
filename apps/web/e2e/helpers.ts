// Shared auth helpers for the e2e specs.
//
// /api/auth/password/register, /login and /resend-verification are
// rate-limited per IP (10/min, 10/min, 5/min) — a real, intentional
// anti-abuse control that the suite must live with rather than weaken.
// Every spec runs from 127.0.0.1, so the whole suite shares one budget.
// Two things keep it inside that budget reliably:
//
//   1. Each account is registered + verified exactly once per run, from a
//      throwaway API context; verifying logs the account in, and that
//      session cookie is cached and simply added to whichever browser
//      context later needs to act as that user. No /login round-trip per
//      test, and no burning register calls on "409 already exists".
//   2. When a 429 does happen (e.g. a second run started within a minute
//      of the first), wait out the server's own `retry-after` and extend
//      the current test's timeout by that wait, so a legitimate back-off
//      never turns into a spurious 30s test timeout.

import {
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Cookie,
  type Page,
  type Response,
  expect,
  request as playwrightRequest,
  test,
} from '@playwright/test';
import { getVerificationToken } from './dbHelpers';

export const PASS = 'correct horse battery';

const MAX_RATE_LIMIT_RETRIES = 4;

/** Wait out a 429's `retry-after`, extending the running test's timeout by the same amount. */
async function backOff(res: APIResponse | Response): Promise<void> {
  const retryAfterSec = Number(res.headers()['retry-after'] ?? '5') || 5;
  const waitMs = (retryAfterSec + 1) * 1000;
  test.info().setTimeout(test.info().timeout + waitMs);
  await new Promise((r) => setTimeout(r, waitMs));
}

/** POST to a rate-limited auth endpoint, retrying on 429. */
export async function postAuth(
  request: APIRequestContext,
  path: string,
  data: Record<string, string>,
): Promise<APIResponse> {
  for (let attempt = 0; ; attempt++) {
    const res = await request.post(path, { data });
    if (res.status() !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return res;
    await backOff(res);
  }
}

/**
 * Drive a UI form that POSTs to a rate-limited auth endpoint: run
 * `submit`, and if the resulting request to `path` comes back 429, wait
 * and submit again. Returns the final (non-429) response.
 */
export async function submitAuthForm(
  page: Page,
  path: string,
  submit: () => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const resP = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path,
    );
    await submit();
    const res = await resP;
    if (res.status() !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return res;
    await backOff(res);
  }
}

const sessions = new Map<string, Cookie[]>();

/**
 * Make sure `email` exists and is verified, and return a session cookie
 * for it. Idempotent and cached for the rest of the run, so it's safe to
 * call from every test / beforeEach.
 */
export async function ensureUser(email: string, displayName = email): Promise<Cookie[]> {
  const cached = sessions.get(email);
  if (cached) return cached;

  const { baseURL } = test.info().project.use;
  const api = await playwrightRequest.newContext(baseURL ? { baseURL } : {});
  try {
    const reg = await postAuth(api, '/api/auth/password/register', {
      email,
      password: PASS,
      displayName,
    });
    if (reg.status() === 409) {
      // Registered by something outside this cache (e.g. a UI flow) — just log in.
      const login = await postAuth(api, '/api/auth/password/login', { email, password: PASS });
      expect(login.ok(), `login ${email}: ${login.status()} ${await login.text()}`).toBe(true);
    } else {
      expect(reg.ok(), `register ${email}: ${reg.status()} ${await reg.text()}`).toBe(true);
      const token = await getVerificationToken(email);
      const verify = await api.post(`/api/auth/password/verify-email/${token}`);
      expect(verify.ok(), `verify ${email}: ${verify.status()}`).toBe(true);
    }
    const { cookies } = await api.storageState();
    expect(cookies.length, `no session cookie for ${email}`).toBeGreaterThan(0);
    sessions.set(email, cookies);
    return cookies;
  } finally {
    await api.dispose();
  }
}

/** Sign `target` (a page's context, or a context) in as `email`, registering it first if needed. */
export async function signIn(
  target: Page | BrowserContext,
  email: string,
  displayName = email,
): Promise<void> {
  const cookies = await ensureUser(email, displayName);
  const ctx = 'context' in target ? target.context() : target;
  await ctx.addCookies(cookies);
}
