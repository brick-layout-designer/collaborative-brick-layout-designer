// Best-effort invite email via SMTP.
//
// Per PLAN.md decision: "copy-paste link by default, SMTP if configured".
// When `env.smtp` is null the function returns false without throwing —
// the inviter still gets the URL in the API response and copy-pastes it.
//
// We dynamically import nodemailer the first time we need it so the
// server doesn't pay the require cost when SMTP is disabled.

import { env } from '../env.js';

interface SendInviteEmailArgs {
  to: string;
  inviteUrl: string;
  inviterName: string;
}

let transporterCache: unknown | null = null;

export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<boolean> {
  if (!env.smtp) return false;
  const nodemailer = await import('nodemailer');
  const smtp = env.smtp;

  const transporter =
    transporterCache ??
    nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
  transporterCache = transporter;

  const subject = `${args.inviterName} invited you to a layout`;
  const text =
    `${args.inviterName} invited you to collaborate on a Collaborative ` +
    `Layout Designer layout.\n\nOpen this link to accept:\n\n${args.inviteUrl}\n`;
  const html =
    `<p>${args.inviterName} invited you to collaborate on a ` +
    `Collaborative Brick Layout Designer layout.</p>` +
    `<p><a href="${args.inviteUrl}">Open in Collaborative Brick Layout Designer</a></p>` +
    `<p style="color:#888">Or paste this URL into your browser: ${args.inviteUrl}</p>`;

  await (transporter as { sendMail: (opts: unknown) => Promise<unknown> }).sendMail({
    from: smtp.from,
    to: args.to,
    subject,
    text,
    html,
  });
  return true;
}
