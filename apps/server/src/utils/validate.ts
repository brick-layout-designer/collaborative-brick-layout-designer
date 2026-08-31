/** RFC-5321 basic email validation — rejects obviously malformed addresses. */
export function isValidEmail(email: unknown): email is string {
  if (typeof email !== 'string') return false;
  if (email.length === 0 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
