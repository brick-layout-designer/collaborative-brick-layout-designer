// A short plain email about someone's account or club: their data
// download is ready, their account will be deleted, it was restored.
// Best effort: false when the site can't send email (no SMTP), and the
// in-app notice is what counts. Links are built from PUBLIC_URL, never a
// fixed host.

import { getTransporter } from './transporter.js';
import { env } from '../env.js';
import { escapeHtml } from '../utils/validate.js';

export function siteUrl(path: string): string {
  return `${env.publicUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function sendNoticeEmail(args: {
  to: string;
  subject: string;
  /** Paragraphs, plain text. */
  paragraphs: string[];
  link?: { text: string; path: string };
}): Promise<boolean> {
  try {
    const resolved = await getTransporter();
    if (!resolved) return false;
    const { transporter, config } = resolved;
    const url = args.link ? siteUrl(args.link.path) : null;
    const text = [...args.paragraphs, ...(url && args.link ? [`${args.link.text}: ${url}`] : [])].join('\n\n') + '\n';
    const html =
      args.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('') +
      (url && args.link ? `<p><a href="${escapeHtml(url)}">${escapeHtml(args.link.text)}</a></p>` : '');
    await transporter.sendMail({ from: config.from, to: args.to, subject: args.subject, text, html });
    return true;
  } catch {
    return false;
  }
}
