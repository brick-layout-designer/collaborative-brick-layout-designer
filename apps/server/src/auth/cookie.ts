import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { SESSION_COOKIE, validateSession } from './session.js';
import type { User } from '../db/schema.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
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

export async function attachUser(req: FastifyRequest, reply: FastifyReply): Promise<void> {
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
