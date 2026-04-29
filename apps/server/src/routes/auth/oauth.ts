import type { FastifyInstance } from 'fastify';
import { generateCodeVerifier, generateState, OAuth2RequestError } from 'arctic';
import { google, github, type NormalisedProfile, type ProviderId } from '../../auth/providers.js';
import { resolveOauthUser } from '../../auth/users.js';
import { createSession } from '../../auth/session.js';
import { setSessionCookie } from '../../auth/cookie.js';
import { env } from '../../env.js';

const STATE_COOKIE = 'cld_oauth_state';
const VERIFIER_COOKIE = 'cld_oauth_verifier';

export async function oauthRoutes(app: FastifyInstance) {
  // ---- Google ------------------------------------------------------------
  const googleClient = google;
  if (googleClient) {
    app.get('/api/auth/google', async (_req, reply) => {
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

    app.get('/api/auth/google/callback', async (req, reply) => {
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
        throw e;
      }
    });
  }

  // ---- GitHub ------------------------------------------------------------
  const githubClient = github;
  if (githubClient) {
    app.get('/api/auth/github', async (_req, reply) => {
      const state = generateState();
      const url = githubClient.createAuthorizationURL(state, ['read:user', 'user:email']);
      setStateCookies(reply, state, '');
      return reply.redirect(url.toString());
    });

    app.get('/api/auth/github/callback', async (req, reply) => {
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
    // For now, redirect to a link-confirmation page (UI handles the prompt).
    // The pending link is encoded as a short-lived cookie; the confirmation
    // endpoint (apps/web /link route) will POST to /api/auth/link to commit.
    reply.setCookie(
      'cld_pending_link',
      JSON.stringify({ provider, providerUserId: profile.providerUserId, userId: user.id }),
      {
        httpOnly: true,
        secure: env.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 10,
      },
    );
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

async function fetchGoogleProfile(accessToken: string): Promise<NormalisedProfile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('google userinfo failed');
  const data = (await res.json()) as {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  };
  return {
    providerUserId: data.sub,
    email: data.email,
    displayName: data.name ?? data.email,
    avatarUrl: data.picture ?? null,
  };
}

async function fetchGithubProfile(accessToken: string): Promise<NormalisedProfile> {
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cld-web' },
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
      headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'cld-web' },
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
