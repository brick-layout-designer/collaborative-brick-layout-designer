// Token management for the signed-in web user: list their API tokens
// (desktop sign-ins) and revoke them. Web-session only — none of these
// routes carry `config.apiToken`, so a token can't list or revoke tokens.
// Secrets are never returned; tokens are minted only by the device-code
// flow (routes/auth/device.ts).

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/cookie.js';
import { listApiTokens, revokeApiToken, scopesOf } from '../auth/apiTokens.js';
import { writeAuditEvent } from '../audit/writeAuditEvent.js';
import type { ApiToken } from '../db/schema.js';

function toListItem(t: ApiToken) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    last4: t.last4,
    scopes: scopesOf(t),
    createdAt: t.createdAt.getTime(),
    lastUsedAt: t.lastUsedAt?.getTime() ?? null,
    expiresAt: t.expiresAt.getTime(),
  };
}

export async function tokenRoutes(app: FastifyInstance) {
  app.get('/api/tokens', async (req) => {
    const user = requireUser(req);
    return { tokens: (await listApiTokens(user.id)).map(toListItem) };
  });

  app.delete<{ Params: { id: string } }>(
    '/api/tokens/:id',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const revoked = await revokeApiToken(user.id, req.params.id);
      if (!revoked) return reply.code(404).send({ error: 'not_found' });
      await writeAuditEvent({
        resourceKind: 'user',
        resourceId: user.id,
        userId: user.id,
        eventType: 'api_token_revoke',
        payload: { tokenId: revoked.id, name: revoked.name },
      });
      return { ok: true };
    },
  );
}
