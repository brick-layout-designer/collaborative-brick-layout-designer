import { randomUUID, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { createSession } from '../../auth/session.js';
import { setSessionCookie } from '../../auth/cookie.js';
import { sendVerificationEmail } from '../../email/sendVerification.js';
import { getPlatformSettings } from '../../auth/platformSettings.js';
import { env } from '../../env.js';

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Delete any existing verification token for a user and issue a fresh
 * one, emailing the link if SMTP is configured. Used by both register
 * and resend. When SMTP isn't configured the link is logged instead —
 * there's no copy-paste fallback surfaced to the client the way invite
 * links have, since a brand-new account has nowhere else to show it.
 */
async function issueVerification(log: FastifyBaseLogger, userId: string, email: string): Promise<void> {
  await db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.userId, userId));
  const token = randomBytes(24).toString('hex');
  await db.insert(schema.emailVerifications).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    createdAt: new Date(),
  });
  const verifyUrl = `${env.publicUrl}/verify-email/${token}`;
  let delivered = false;
  try {
    delivered = await sendVerificationEmail({ to: email, verifyUrl });
  } catch (err) {
    log.warn({ err }, 'failed to send verification email');
  }
  if (!delivered) {
    // No SMTP configured (or delivery failed): the link is otherwise
    // unrecoverable, so surface it in the server log for local/dev use
    // and for an operator to hand-deliver if needed.
    log.info({ email, verifyUrl }, 'email verification link (SMTP not configured or delivery failed)');
  }
}

export async function passwordRoutes(app: FastifyInstance) {
  if (!env.enablePasswordAuth) return;

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    '/api/auth/password/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, password, displayName } = req.body;
      if (!email || !password || password.length < 8 || password.length > 128) {
        return reply.code(400).send({ error: 'invalid_input' });
      }
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (existing) return reply.code(409).send({ error: 'email_taken' });

      const settings = await getPlatformSettings();
      const passwordHash = await hash(password, ARGON_OPTS);
      const id = randomUUID();
      await db.insert(schema.users).values({
        id,
        email,
        displayName: displayName ?? email,
        avatarUrl: null,
        passwordHash,
        isDemoAccount: env.demoMode,
        isGlobalAdmin: false,
        emailVerified: !settings.requireEmailVerification,
        createdAt: new Date(),
      });

      if (!settings.requireEmailVerification) {
        // Verification is off — behave exactly like pre-verification
        // register did: create the account already verified and log
        // straight in.
        const { token, expiresAt } = await createSession(id);
        setSessionCookie(reply, token, expiresAt);
        return reply.send({ ok: true, verificationRequired: false });
      }

      await issueVerification(req.log, id, email);
      // No session cookie yet — the account can't log in until verified.
      return reply.send({ ok: true, verificationRequired: true });
    },
  );

  app.post<{ Body: { email: string } }>(
    '/api/auth/password/resend-verification',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email } = req.body;
      if (!email) return reply.code(400).send({ error: 'invalid_input' });
      const settings = await getPlatformSettings();
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      // Always return ok regardless of whether the account exists or is
      // already verified — don't let this endpoint be used to enumerate
      // registered emails.
      if (settings.requireEmailVerification && user && user.passwordHash && !user.emailVerified) {
        await issueVerification(req.log, user.id, user.email);
      }
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { token: string } }>(
    '/api/auth/password/verify-email/:token',
    async (req, reply) => {
      const verification = await db
        .select()
        .from(schema.emailVerifications)
        .where(eq(schema.emailVerifications.token, req.params.token))
        .get();
      if (!verification) return reply.code(404).send({ error: 'verification_not_found' });
      if (verification.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ error: 'verification_expired' });
      }

      await db
        .update(schema.users)
        .set({ emailVerified: true })
        .where(eq(schema.users.id, verification.userId));
      await db
        .delete(schema.emailVerifications)
        .where(eq(schema.emailVerifications.id, verification.id));

      // Verifying logs the user in directly — they already proved
      // control of the mailbox, which is a stronger check than a
      // password alone.
      const { token, expiresAt } = await createSession(verification.userId);
      setSessionCookie(reply, token, expiresAt);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/password/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      if (!email || !password || password.length > 128) return reply.code(400).send({ error: 'invalid_input' });
      const user = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (!user || !user.passwordHash) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      const ok = await verify(user.passwordHash, password, ARGON_OPTS);
      if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
      if (!user.emailVerified) {
        // Re-check live: an admin may have turned verification off
        // after this account registered while it was still on. Don't
        // block a login that the current policy no longer requires.
        const settings = await getPlatformSettings();
        if (settings.requireEmailVerification) {
          return reply.code(403).send({ error: 'email_not_verified' });
        }
      }
      const { token, expiresAt } = await createSession(user.id);
      setSessionCookie(reply, token, expiresAt);
      return reply.send({ ok: true });
    },
  );
}
