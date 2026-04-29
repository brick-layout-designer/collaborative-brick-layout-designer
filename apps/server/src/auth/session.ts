import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { User } from '../db/schema.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'cld_session';

function generateToken(): string {
  // 20 random bytes → base32-ish; we just hex-encode for simplicity.
  return randomBytes(24).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSession(
  token: string,
): Promise<{ user: User; session: { id: string; expiresAt: Date }; refreshed: boolean } | null> {
  const id = hashToken(token);
  const row = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
    .where(eq(schema.sessions.id, id))
    .get();
  if (!row) return null;

  const now = Date.now();
  if (row.session.expiresAt.getTime() < now) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }

  // Sliding expiry: refresh when within the second half of the window.
  let refreshed = false;
  if (row.session.expiresAt.getTime() - now < FIFTEEN_DAYS_MS) {
    const expiresAt = new Date(now + THIRTY_DAYS_MS);
    await db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, id));
    row.session.expiresAt = expiresAt;
    refreshed = true;
  }

  return { user: row.user, session: { id, expiresAt: row.session.expiresAt }, refreshed };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(token)));
}

export async function invalidateAllSessions(userId: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}
