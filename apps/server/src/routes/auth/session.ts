import type { FastifyInstance } from 'fastify';
import { invalidateSession, SESSION_COOKIE } from '../../auth/session.js';
import { clearSessionCookie } from '../../auth/cookie.js';
import { listLinkedProviders } from '../../auth/users.js';
import { listProviders } from '../../auth/providers.js';
import { env } from '../../env.js';

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
