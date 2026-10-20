// "Someone tried to make an account with your email address": sent to
// the owner of an existing account when the sign-up form is used with
// their address. The sign-up form answers the same either way, so this
// email is the only place that says the account already exists. It has
// no link that signs in, only the sign-in page.

import { getTransporter } from './transporter.js';
import { siteUrl } from './sendNotice.js';
import { escapeHtml } from '../utils/validate.js';

export async function sendSignupNoticeEmail(args: { to: string }): Promise<boolean> {
  const resolved = await getTransporter();
  if (!resolved) return false;
  const { transporter, config } = resolved;
  const loginUrl = siteUrl('/login');
  const safeUrl = escapeHtml(loginUrl);
  const safeEmail = escapeHtml(args.to);

  const subject = 'Someone tried to sign up with your email — Collaborative Brick Layout Designer';
  const text =
    `Someone just tried to create a new account with ${args.to}.\n\n` +
    `You already have an account with this address, so nothing was changed.\n\n` +
    `If it was you, sign in instead: ${loginUrl}\n\n` +
    `If it wasn't you, you can ignore this email.\n`;
  const html =
    `<p>Someone just tried to create a new account with ${safeEmail}.</p>` +
    `<p>You already have an account with this address, so nothing was changed.</p>` +
    `<p>If it was you, <a href="${safeUrl}">sign in</a> instead.</p>` +
    `<p style="color:#888">If it wasn't you, you can ignore this email.</p>`;

  await transporter.sendMail({ from: config.from, to: args.to, subject, text, html });
  return true;
}
