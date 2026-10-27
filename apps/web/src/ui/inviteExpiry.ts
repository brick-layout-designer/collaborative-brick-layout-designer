// What a waiting invite says about its date in the share dialogs: when it
// expires, or that it has (an expired link no longer works, so the person
// needs a new invite).

export function inviteExpiry(expiresAt: number, now: number = Date.now()): string {
  if (expiresAt <= now) return 'expired: invite them again for a new link';
  return `expires ${new Date(expiresAt).toLocaleDateString()}`;
}
