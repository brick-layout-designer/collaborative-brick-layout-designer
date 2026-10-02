import type { FastifyInstance } from 'fastify';
import { generateCodeVerifier, generateState, OAuth2RequestError } from 'arctic';
import { google, github, type NormalisedProfile, type ProviderId } from '../../auth/providers.js';
import { and, eq } from 'drizzle-orm';
import { linkProvider, resolveOauthUser } from '../../auth/users.js';
import { createSession } from '../../auth/session.js';
import { requireUser, setSessionCookie } from '../../auth/cookie.js';
import { isDemoUser } from '../../demo/demoAccount.js';
import {
  consumePendingLink,
  createPendingLink,
  peekPendingLink,
  PENDING_LINK_COOKIE,
  PENDING_LINK_TTL_MS,
} from '../../auth/pendingLinks.js';
import { db, schema } from '../../db/index.js';
import { env } from '../../env.js';

const STATE_COOKIE = 'cld_oauth_state';
const VERIFIER_COOKIE = 'cld_oauth_verifier';

export async function oauthRoutes(app: FastifyInstance) {
  // ---- Google ------------------------------------------------------------
  const googleClient = google;
  if (googleClient) {
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    app.get('/api/auth/google', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_req, reply) => {
      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const url = googleClient.createAuthorizationURL(state, codeVerifier, [
        'openid',
        'email',
        'profile',
      ]);
      setStateCookies(reply, state, codeVerifier);
      return reply.redirect(url.toString());
    });

    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    app.get('/api/auth/google/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const params = req.query as { code?: string; state?: string };
      const stored = readStateCookies(req);
      if (!params.code || !params.state || !stored.state || params.state !== stored.state) {
        return reply.code(400).send({ error: 'invalid_state' });
      }
      try {
        const tokens = await googleClient.validateAuthorizationCode(params.code, stored.verifier);
        const profile = await fetchGoogleProfile(tokens.accessToken());
        return await completeLogin(reply, 'google', profile);
      } catch (e) {
        if (e instanceof OAuth2RequestError) return reply.code(400).send({ error: 'oauth_error' });
        if (e instanceof UnverifiedEmailError) return reply.code(403).send({ error: 'email_not_verified' });
        throw e;
      }
    });
  }

  // ---- GitHub ------------------------------------------------------------
  const githubClient = github;
  if (githubClient) {
    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    app.get('/api/auth/github', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (_req, reply) => {
      const state = generateState();
      const url = githubClient.createAuthorizationURL(state, ['read:user', 'user:email']);
      setStateCookies(reply, state, '');
      return reply.redirect(url.toString());
    });

    // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
    app.get('/api/auth/github/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
      const params = req.query as { code?: string; state?: string };
      const stored = readStateCookies(req);
      if (!params.code || !params.state || !stored.state || params.state !== stored.state) {
        return reply.code(400).send({ error: 'invalid_state' });
      }
      try {
        const tokens = await githubClient.validateAuthorizationCode(params.code);
        const profile = await fetchGithubProfile(tokens.accessToken());
        return await completeLogin(reply, 'github', profile);
      } catch (e) {
        if (e instanceof OAuth2RequestError) return reply.code(400).send({ error: 'oauth_error' });
        throw e;
      }
    });
  }

  // ---- Account linking ----------------------------------------------------
  // After an OAuth sign-in whose email matched an existing account (see
  // completeLogin), the browser holds a pending-link cookie. The link is
  // committed only from a session already signed in to THAT account.

  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.get('/api/auth/link', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const link = peekPendingLink(req.cookies[PENDING_LINK_COOKIE]);
    if (!link) return reply.code(404).send({ error: 'no_pending_link' });
    return { provider: link.provider, signedInAsTarget: req.user?.id === link.userId };
  });

  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.post('/api/auth/link', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    if (isDemoUser(user)) return reply.code(403).send({ error: 'demo_account_cannot_link' });
    const token = req.cookies[PENDING_LINK_COOKIE];
    const link = peekPendingLink(token);
    if (!token || !link) return reply.code(404).send({ error: 'no_pending_link' });
    // Proof of control of the existing account: you must be signed in to it.
    if (link.userId !== user.id) return reply.code(403).send({ error: 'wrong_account' });
    const existing = await db
      .select({ userId: schema.oauthAccounts.userId })
      .from(schema.oauthAccounts)
      .where(
        and(
          eq(schema.oauthAccounts.provider, link.provider),
          eq(schema.oauthAccounts.providerUserId, link.providerUserId),
        ),
      )
      .get();
    if (existing && existing.userId !== user.id) {
      consumePendingLink(token);
      reply.clearCookie(PENDING_LINK_COOKIE, { path: '/' });
      return reply.code(409).send({ error: 'provider_account_already_linked' });
    }
    await linkProvider(user.id, link.provider, link.providerUserId);
    consumePendingLink(token);
    reply.clearCookie(PENDING_LINK_COOKIE, { path: '/' });
    return { ok: true, provider: link.provider };
  });

  // codeql[js/missing-rate-limiting] - rate limited via Fastify config.rateLimit
  app.delete('/api/auth/link', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = req.cookies[PENDING_LINK_COOKIE];
    if (token) consumePendingLink(token);
    reply.clearCookie(PENDING_LINK_COOKIE, { path: '/' });
    return { ok: true };
  });

  // OIDC is plumbed through openid-client; deferred from this scaffold pass
  // so the file doesn't grow unbounded. Provider listing already advertises it
  // when env.oidc is set; the route handlers go in `oidc.ts` next.
}

async function completeLogin(
  reply: import('fastify').FastifyReply,
  provider: ProviderId,
  profile: NormalisedProfile,
) {
  const { user, linkPrompt } = await resolveOauthUser(provider, profile);
  if (linkPrompt) {
    // Redirect to the link-confirmation page. The pending link is kept
    // server-side (see auth/pendingLinks.ts); the cookie only carries an
    // opaque token. POST /api/auth/link commits it once the user is
    // signed in to the existing account.
    const token = createPendingLink({ provider, providerUserId: profile.providerUserId, userId: user.id });
    reply.setCookie(PENDING_LINK_COOKIE, token, {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: PENDING_LINK_TTL_MS / 1000,
    });
    return reply.redirect('/link');
  }
  const { token, expiresAt } = await createSession(user.id);
  setSessionCookie(reply, token, expiresAt);
  return reply.redirect('/');
}

function setStateCookies(
  reply: import('fastify').FastifyReply,
  state: string,
  verifier: string,
) {
  const opts = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 10,
  };
  reply.setCookie(STATE_COOKIE, state, opts);
  reply.setCookie(VERIFIER_COOKIE, verifier, opts);
}

function readStateCookies(req: import('fastify').FastifyRequest) {
  return {
    state: req.cookies[STATE_COOKIE] ?? '',
    verifier: req.cookies[VERIFIER_COOKIE] ?? '',
  };
}

/** Thrown when the provider can't vouch for the account's email. */
export class UnverifiedEmailError extends Error {
  constructor() {
    super('provider email not verified');
  }
}

export async function fetchGoogleProfile(accessToken: string): Promise<NormalisedProfile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('google userinfo failed');
  const data = (await res.json()) as {
    sub: string;
    email: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  // OAuth accounts are created with emailVerified=true and matched to
  // invites by email, so an address Google hasn't verified (possible for
  // Google accounts registered with a non-Gmail address) must not sign in.
  if (data.email_verified !== true || !data.email) throw new UnverifiedEmailError();
  return {
    providerUserId: data.sub,
    email: data.email,
    displayName: data.name ?? data.email,
    avatarUrl: data.picture ?? null,
  };
}

async function fetchGithubProfile(accessToken: string): Promise<NormalisedProfile> {
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'collaborative-brick-layout-designer' },
  });
  if (!userRes.ok) throw new Error('github user failed');
  const user = (await userRes.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string | null;
    email: string | null;
  };
  let email = user.email;
  if (!email) {
    const emailRes = await fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'collaborative-brick-layout-designer' },
    });
    if (emailRes.ok) {
      const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    }
  }
  if (!email) throw new Error('github email unavailable');
  return {
    providerUserId: String(user.id),
    email,
    displayName: user.name ?? user.login,
    avatarUrl: user.avatar_url,
  };
}
