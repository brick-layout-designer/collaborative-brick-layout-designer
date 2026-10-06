// The site's privacy page (/privacy): a notice the admin writes (markdown)
// and who to ask about personal data. The contact is an email address or a
// web address; PRIVACY_CONTACT, when set, forces it (and Admin › Settings
// says so). Nothing here is hard-coded: whoever runs the server says it.

import { getPlatformSettings } from '../auth/platformSettings.js';

export const NOTICE_MAX = 50_000;
export const CONTACT_MAX = 200;

/** An email address, or an http(s) address. */
export function validContact(v: string): boolean {
  if (v.length > CONTACT_MAX || /\s/.test(v)) return false;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function privacyContact(): Promise<{ value: string | null; setting: string | null; forcedBy: string | null }> {
  const setting = (await getPlatformSettings()).privacyContact ?? null;
  const env = process.env.PRIVACY_CONTACT?.trim();
  if (env && validContact(env)) return { value: env, setting, forcedBy: 'PRIVACY_CONTACT' };
  return { value: setting, setting, forcedBy: null };
}
