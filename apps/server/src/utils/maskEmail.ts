// An email address shown to someone who shouldn't read it in full: the
// first letter of the name and the domain ("s…@example.com"). Enough to
// tell two invites apart; not enough to learn someone's address.

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '…';
  return `${[...email.slice(0, at)][0]}…${email.slice(at)}`;
}

/** A copy of an audit payload with any email fields masked. */
export function maskPayloadEmails(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
  for (const key of ['invitedEmail', 'targetEmail', 'email']) {
    if (typeof out[key] === 'string') out[key] = maskEmail(out[key]);
  }
  return out;
}
