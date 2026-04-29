import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, schema } from '../test/helpers.js';
import {
  createSession,
  invalidateAllSessions,
  invalidateSession,
  validateSession,
} from './session.js';

async function makeUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    email: `${id}@example.com`,
    displayName: 'Test',
    avatarUrl: null,
    passwordHash: null,
    isDemoAccount: false,
    isGlobalAdmin: false,
    createdAt: new Date(),
  });
  return id;
}

describe('session', () => {
  beforeEach(() => resetDb());

  it('creates a session and validates the returned token', async () => {
    const userId = await makeUser();
    const { token, expiresAt } = await createSession(userId);

    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const result = await validateSession(token);
    expect(result).not.toBeNull();
    expect(result?.user.id).toBe(userId);
  });

  it('rejects an invalid token', async () => {
    const result = await validateSession('not-a-real-token');
    expect(result).toBeNull();
  });

  it('rejects an expired session and deletes the row', async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    // Force-expire the row directly. We hash the token to match how it's stored.
    const { createHash } = await import('node:crypto');
    const id = createHash('sha256').update(token).digest('hex');
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessions.id, id));

    expect(await validateSession(token)).toBeNull();
    const remaining = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    expect(remaining).toHaveLength(0);
  });

  it('refreshes the expiry when within the sliding window', async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);

    // Push the expiry to within the second half of the 30-day window.
    const { createHash } = await import('node:crypto');
    const id = createHash('sha256').update(token).digest('hex');
    const { eq } = await import('drizzle-orm');
    const closeExpiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
    await db.update(schema.sessions).set({ expiresAt: closeExpiry }).where(eq(schema.sessions.id, id));

    const result = await validateSession(token);
    expect(result?.refreshed).toBe(true);
    expect(result?.session.expiresAt.getTime()).toBeGreaterThan(closeExpiry.getTime());
  });

  it('invalidateSession deletes the row', async () => {
    const userId = await makeUser();
    const { token } = await createSession(userId);
    await invalidateSession(token);
    expect(await validateSession(token)).toBeNull();
  });

  it('invalidateAllSessions removes every session for the user', async () => {
    const userId = await makeUser();
    await createSession(userId);
    await createSession(userId);
    await invalidateAllSessions(userId);

    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it('stores only the hashed token in the database (not the bearer token)', async () => {
    // This is the key security invariant: a DB read must not yield credentials
    // a future request can authenticate with.
    const userId = await makeUser();
    const { token } = await createSession(userId);

    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(token);
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});
