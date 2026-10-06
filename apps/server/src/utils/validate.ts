/** RFC-5321 basic email validation — rejects obviously malformed addresses. */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  if (email.length === 0 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Canonical form for storing and comparing email addresses: trimmed and
 * lower-cased. (Local parts are technically case-sensitive, but no real
 * provider treats them so, and case-variant duplicates let one mailbox
 * hold several accounts / dodge invite email matching.)
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when two addresses are the same mailbox after normalisation. */
export function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/** Escape SQLite LIKE wildcards so user input is treated as a literal string. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&');
}

/**
 * Escape a string for safe interpolation into HTML markup (text content
 * or a quoted attribute value). Used for the plain-string HTML email
 * bodies built in email/sendInvite.ts — user-controlled values like
 * displayName reach these templates (e.g. as "inviterName"), and unlike
 * the web app's React rendering (which escapes automatically), these
 * are hand-built HTML strings with no framework doing it for us.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Where to go after signing in (`?next=`): a path on this site only, so
 * a sign-in link can't send anyone elsewhere. Anything else is null.
 */
export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // No control characters (a header or a log line must not be split).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
