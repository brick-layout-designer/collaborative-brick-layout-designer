// What a long-lived connection authenticated with: a browser session
// (cookie) or an API token (desktop Bearer). The realtime WebSocket
// re-checks it periodically and listens for its revocation, whichever
// kind it is.

import { isSessionActive } from './session.js';
import { isApiTokenActive } from './apiTokens.js';
import type { CredentialRevocation } from './revocation.js';

export type Credential = { kind: 'session'; id: string } | { kind: 'token'; id: string };

/** True while the credential still authenticates (not revoked/expired). */
export async function isCredentialActive(c: Credential): Promise<boolean> {
  return c.kind === 'session' ? isSessionActive(c.id) : isApiTokenActive(c.id);
}

/** Does revocation `r` end credential `c` held by `userId`? */
export function isRevokedBy(c: Credential, userId: string, r: CredentialRevocation): boolean {
  if ('userId' in r) return r.userId === userId;
  if ('sessionId' in r) return c.kind === 'session' && c.id === r.sessionId;
  return c.kind === 'token' && c.id === r.tokenId;
}

/** WebSocket close reason for a credential that stopped authenticating. */
export function revokedReason(c: Credential): 'session_revoked' | 'token_revoked' {
  return c.kind === 'session' ? 'session_revoked' : 'token_revoked';
}
