// Best-effort verification email via SMTP.
//
// Same shape as sendInvite.ts — when `env.smtp` is null the function
// returns false without throwing. Unlike an invite, there's no
// copy-paste fallback surfaced in the API response (a verification link
// isn't something the registering user already has any other way to
// get), so the register route also logs the link when SMTP isn't
// configured — see routes/auth/password.ts.

import { env } from '../env.js';

interface SendVerificationEmailArgs {
  to: string;
  verifyUrl: string;
}

let transporterCache: unknown | null = null;

export async function sendVerificationEmail(args: SendVerificationEmailArgs): Promise<boolean> {
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

  const subject = 'Verify your email — Collaborative Brick Layout Designer';
  const text =
    `Welcome to Collaborative Brick Layout Designer!\n\n` +
    `Confirm your email address to finish setting up your account:\n\n${args.verifyUrl}\n\n` +
    `This link expires in 24 hours.\n`;
  const html =
    `<p>Welcome to Collaborative Brick Layout Designer!</p>` +
    `<p>Confirm your email address to finish setting up your account:</p>` +
    `<p><a href="${args.verifyUrl}">Verify my email</a></p>` +
    `<p style="color:#888">Or paste this URL into your browser: ${args.verifyUrl}</p>` +
    `<p style="color:#888">This link expires in 24 hours.</p>`;

  await (transporter as { sendMail: (opts: unknown) => Promise<unknown> }).sendMail({
    from: smtp.from,
    to: args.to,
    subject,
    text,
    html,
  });
  return true;
}
