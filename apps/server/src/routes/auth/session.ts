import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { invalidateSession, SESSION_COOKIE } from '../../auth/session.js';
import { clearSessionCookie, requireUser } from '../../auth/cookie.js';
import { listLinkedProviders } from '../../auth/users.js';
import { listProviders } from '../../auth/providers.js';
import { db, schema } from '../../db/index.js';
import { env } from '../../env.js';

const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 60;

export async function sessionRoutes(app: FastifyInstance) {
  app.get('/api/auth/me', async (req) => {
    if (!req.user) return { user: null };
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.displayName,
        avatarUrl: req.user.avatarUrl,
        isDemoAccount: req.user.isDemoAccount,
        isGlobalAdmin: req.user.isGlobalAdmin,
        linkedProviders: await listLinkedProviders(req.user.id),
      },
    };
  });

  // Self-service display-name change. displayName has no DB-level
  // uniqueness constraint (see schema.ts's comment on users.displayName)
  // — it's a pure display label, never used as a lookup key anywhere
  // server-side (invites/collaborators resolve by email or id). A hard
  // "must be unique" requirement would need a migration + backfill for
  // little functional benefit, so this only validates shape (trimmed,
  // non-empty, bounded length) and leaves collisions cosmetic.
  app.patch<{ Body: { displayName?: string } }>('/api/auth/me', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const user = requireUser(req);
    const raw = req.body?.displayName;
    if (typeof raw !== 'string') return reply.code(400).send({ error: 'invalid_input' });
    const displayName = raw.trim();
    if (displayName.length < DISPLAY_NAME_MIN || displayName.length > DISPLAY_NAME_MAX) {
      return reply.code(400).send({ error: 'invalid_display_name' });
    }
    await db.update(schema.users).set({ displayName }).where(eq(schema.users.id, user.id));
    return { ok: true, displayName };
  });

  app.get('/api/auth/providers', async () => ({
    providers: listProviders(),
    passwordEnabled: env.enablePasswordAuth,
  }));

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await invalidateSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
