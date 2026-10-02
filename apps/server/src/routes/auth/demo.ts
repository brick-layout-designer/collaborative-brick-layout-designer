// "Try the demo" on the sign-in page: POST /api/auth/demo (JSON, no body
// or `{}`) signs the visitor in as the one demo account while an admin has
// the demo switched on (demo/demoAccount.ts). Works whether or not
// password sign-in is enabled.

import type { FastifyInstance } from 'fastify';
import { createSession } from '../../auth/session.js';
import { setSessionCookie } from '../../auth/cookie.js';
import { getPlatformSettings } from '../../auth/platformSettings.js';
import { DEMO_USER_ID, ensureDemoUser } from '../../demo/demoAccount.js';
import { runDemoReset } from '../../demo/reset.js';

export async function demoAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/demo', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const settings = await getPlatformSettings();
    if (!settings.demoEnabled) return reply.code(404).send({ error: 'demo_off' });
    await ensureDemoUser();
    // Never reset yet (just switched on): put the samples in first.
    if (!settings.demoLastResetAt) await runDemoReset();
    const { token, expiresAt } = await createSession(DEMO_USER_ID);
    setSessionCookie(reply, token, expiresAt);
    return reply.send({ ok: true });
  });
}
