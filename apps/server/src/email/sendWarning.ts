// Best-effort warning email via SMTP. The warning itself is the notice in
// the app; this only tells the person to look, when SMTP is set up.

import { getTransporter } from './transporter.js';
import { env } from '../env.js';
import { escapeHtml } from '../utils/validate.js';

const LABEL = { note: 'A note', warning: 'A warning', final: 'A final warning' } as const;

export async function sendWarningEmail(args: {
  to: string;
  severity: keyof typeof LABEL;
  reason: string;
  fromName: string;
}): Promise<boolean> {
  const resolved = await getTransporter();
  if (!resolved) return false;
  const { transporter, config } = resolved;
  const url = `${env.publicUrl.replace(/\/$/, '')}/notices`;
  const subject = `${LABEL[args.severity]} from ${args.fromName}`;
  const text = `${LABEL[args.severity]} from ${args.fromName}:\n\n${args.reason}\n\nSee it and say you've read it here:\n${url}\n`;
  const html =
    `<p>${escapeHtml(LABEL[args.severity])} from ${escapeHtml(args.fromName)}:</p>` +
    `<blockquote>${escapeHtml(args.reason)}</blockquote>` +
    `<p><a href="${escapeHtml(url)}">See it and say you've read it</a></p>`;
  await transporter.sendMail({ from: config.from, to: args.to, subject, text, html });
  return true;
}
