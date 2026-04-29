import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { hash, verify } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { createSession } from '../../auth/session.js';
import { setSessionCookie } from '../../auth/cookie.js';
import { env } from '../../env.js';

const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, outputLen: 32, parallelism: 1 };

export async function passwordRoutes(app: FastifyInstance) {
  if (!env.enablePasswordAuth) return;

  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    '/api/auth/password/register',
    async (req, reply) => {
      const { email, password, displayName } = req.body;
      if (!email || !password || password.length < 8) {
        return reply.code(400).send({ error: 'invalid_input' });
      }
      const existing = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email))
        .get();
      if (existing) return reply.code(409).send({ error: 'email_taken' });

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
        createdAt: new Date(),
      });
      const { token, expiresAt } = await createSession(id);
      setSessionCookie(reply, token, expiresAt);
      return reply.send({ ok: true });
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    '/api/auth/password/login',
    async (req, reply) => {
      const { email, password } = req.body;
      if (!email || !password) return reply.code(400).send({ error: 'invalid_input' });
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
      const { token, expiresAt } = await createSession(user.id);
      setSessionCookie(reply, token, expiresAt);
      return reply.send({ ok: true });
    },
  );
}
