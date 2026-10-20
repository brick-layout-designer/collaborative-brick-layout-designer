// Sign-in pacing per account (the normalized email), on top of the
// per-address limits: after FREE_FAILURES wrong passwords within WINDOW_MS,
// each further try has to wait, doubling from FIRST_DELAY_MS up to
// MAX_DELAY_MS. Never a lock: the right password always works once the
// wait is over, and signing in clears the count. Too-early tries are
// answered at once (429 + Retry-After) and don't count; nothing sleeps on
// the server. In memory: one server process, bounded.

export const LOGIN_PACING = {
  /** Wrong passwords allowed before any wait. */
  FREE_FAILURES: 10,
  /** The count starts over this long after the last wrong password (and any wait). */
  WINDOW_MS: 15 * 60 * 1000,
  /** The first wait; each further wrong password doubles it. */
  FIRST_DELAY_MS: 1000,
  MAX_DELAY_MS: 15 * 60 * 1000,
  /** Accounts tracked at once; the oldest is forgotten first. */
  MAX_TRACKED: 50_000,
} as const;

interface Entry {
  failures: number;
  lastFailureAt: number;
  /** 0 until the free tries are used up. */
  nextAllowedAt: number;
}

const entries = new Map<string, Entry>();

function live(key: string, now: number): Entry | undefined {
  const e = entries.get(key);
  if (!e) return undefined;
  if (now > Math.max(e.lastFailureAt, e.nextAllowedAt) + LOGIN_PACING.WINDOW_MS) {
    entries.delete(key);
    return undefined;
  }
  return e;
}

/** Milliseconds this account must still wait before its next try (0: go ahead). */
export function loginWaitMs(key: string, now: number = Date.now()): number {
  const e = live(key, now);
  return e && e.nextAllowedAt > now ? e.nextAllowedAt - now : 0;
}

/** Count a wrong password for this account. */
export function noteLoginFailure(key: string, now: number = Date.now()): void {
  const e = live(key, now) ?? { failures: 0, lastFailureAt: now, nextAllowedAt: 0 };
  e.failures += 1;
  e.lastFailureAt = now;
  const over = e.failures - LOGIN_PACING.FREE_FAILURES;
  if (over >= 0) {
    // 2^over, without overflowing once the cap is long reached.
    const delay = over >= 30 ? LOGIN_PACING.MAX_DELAY_MS : LOGIN_PACING.FIRST_DELAY_MS * 2 ** over;
    e.nextAllowedAt = now + Math.min(delay, LOGIN_PACING.MAX_DELAY_MS);
  }
  // Re-insert so the map's order is "least recently failed first".
  entries.delete(key);
  if (entries.size >= LOGIN_PACING.MAX_TRACKED) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  entries.set(key, e);
}

/** The right password: start the count over. */
export function noteLoginSuccess(key: string): void {
  entries.delete(key);
}

/** Forget every account (tests). */
export function resetLoginPacing(): void {
  entries.clear();
}

/** How many accounts are tracked (tests). */
export function trackedLoginCount(): number {
  return entries.size;
}
