import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';

export async function ensureBootstrapAdmin(): Promise<void> {
  const email = env.bootstrapAdminEmail;
  const password = env.bootstrapAdminPassword;
  if (!email || !password) return;

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .get();
  if (existing) {
    if (!existing.isGlobalAdmin) {
      await db
        .update(schema.users)
        .set({ isGlobalAdmin: true })
        .where(eq(schema.users.id, existing.id));
      console.log(`[bootstrap] promoted existing user ${email} to global admin`);
    }
    return;
  }

  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
  await db.insert(schema.users).values({
    id: randomUUID(),
    email,
    displayName: email,
    avatarUrl: null,
    passwordHash,
    isDemoAccount: false,
    isGlobalAdmin: true,
    // The bootstrap admin has no inbox to click a verification link
    // from — it's created straight from a trusted env var, so it's
    // exempt from the password-signup email-verification requirement.
    emailVerified: true,
    createdAt: new Date(),
  });
  console.log('====================================================');
  console.log(`[bootstrap] CREATED GLOBAL ADMIN: ${email}`);
  console.log('[bootstrap] change the password from the profile page after first login');
  console.log('====================================================');
}
