import { GitHub, Google } from 'arctic';
import { env } from '../env.js';

export type ProviderId = 'google' | 'github' | 'oidc';

export interface NormalisedProfile {
  providerUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

const callback = (provider: ProviderId): string => `${env.publicUrl}/api/auth/${provider}/callback`;

export const google =
  env.google && new Google(env.google.clientId, env.google.clientSecret, callback('google'));

export const github = env.github && new GitHub(env.github.clientId, env.github.clientSecret, null);
// Arctic's GitHub callback URL is configured in the GitHub app settings, not
// passed to the constructor (Arctic v2 quirk). Operators set
// `${PUBLIC_URL}/api/auth/github/callback` in the GitHub OAuth app.

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  enabled: boolean;
}

export function listProviders(): ProviderInfo[] {
  return [
    { id: 'google', label: 'Google', enabled: !!google },
    { id: 'github', label: 'GitHub', enabled: !!github },
    { id: 'oidc', label: 'Single sign-on', enabled: !!env.oidc },
  ];
}
