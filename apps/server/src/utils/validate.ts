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
