import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { SESSION_COOKIE, validateSession } from './session.js';
import { hasScope, validateApiToken, type ApiScope } from './apiTokens.js';
import type { User } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    /**
     * Set when the request authenticated with an API token (Bearer)
     * rather than the session cookie. Routes that let a token write
     * (only the realtime WebSocket today) check `scopes` themselves.
     */
    apiToken: { id: string; scopes: ApiScope[] } | null;
  }
  interface FastifyContextConfig {
    /**
     * Opt this route in to `Authorization: Bearer bld_pat_…` auth, with
     * the scope the token needs. Routes without it reject every
     * token-authenticated request (403), so the allow-list is exactly
     * the set of routes carrying this config.
     */
    apiToken?: ApiScope;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** The raw `Authorization: Bearer …` credential, or null when absent. */
export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer[ \t]+(\S+)\s*$/i.exec(h);
  return m ? m[1]! : null;
}

/**
 * Populate `req.user` from the session cookie, or — only on routes that
 * opt in via `config.apiToken` — from a Bearer API token. A request that
 * carries a Bearer token never falls back to its cookie: token clients
 * get exactly the token's powers. Tokens are only read from the header,
 * never from the query string (URLs end up in logs and proxies).
 */
export async function attachUser(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  req.apiToken = null;
  const bearer = bearerToken(req);
  if (bearer !== null) {
    req.user = null;
    const needed = req.routeOptions.config?.apiToken;
    if (!needed) return reply.code(403).send({ error: 'token_not_allowed' });
    const result = await validateApiToken(bearer);
    if (!result) {
      reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      return reply.code(401).send({ error: 'invalid_token' });
    }
    if (!hasScope(result.scopes, needed)) {
      reply.header('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${needed}"`);
      return reply.code(403).send({ error: 'insufficient_scope' });
    }
    req.user = result.user;
    req.apiToken = { id: result.token.id, scopes: result.scopes };
    return;
  }

  const token = req.cookies[SESSION_COOKIE];
  if (!token) {
    req.user = null;
    return;
  }
  const result = await validateSession(token);
  if (!result) {
    req.user = null;
    clearSessionCookie(reply);
    return;
  }
  if (result.refreshed) setSessionCookie(reply, token, result.session.expiresAt);
  req.user = result.user;
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) {
    const err = new Error('unauthorized');
    (err as Error & { statusCode?: number }).statusCode = 401;
    throw err;
  }
  return req.user;
}

/**
 * Stricter variant for the platform-admin endpoints. Throws 401 if no
 * session, 403 when the session belongs to a non-global-admin user.
 *
 * Every endpoint mounted at `/api/admin/*` must call this — the
 * boundary is per-route rather than per-prefix because Fastify's
 * preHandler hooks are global, and we want the permission check to
 * sit next to the route's own logic for clarity.
 */
export function requireGlobalAdmin(req: FastifyRequest): User {
  const user = requireUser(req);
  if (!user.isGlobalAdmin) {
    const err = new Error('forbidden');
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
  return user;
}
