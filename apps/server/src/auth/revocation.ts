// Revocation notifications, so long-lived connections (the realtime
// WebSocket) can be dropped the moment the credential that opened them
// ends — logout, "revoke all sessions", user deletion, or an API token
// being revoked — instead of living on until the socket closes by itself.

export type CredentialRevocation = { sessionId: string } | { tokenId: string } | { userId: string };

const revocationListeners = new Set<(r: CredentialRevocation) => void>();

export function onCredentialRevoked(listener: (r: CredentialRevocation) => void): () => void {
  revocationListeners.add(listener);
  return () => revocationListeners.delete(listener);
}

export function notifyCredentialRevoked(r: CredentialRevocation): void {
  for (const l of revocationListeners) {
    try {
      l(r);
    } catch {
      /* a listener's failure must not break logout / revoke */
    }
  }
}
