// Best-effort verification email via SMTP.
//
// Same shape as sendInvite.ts — when no SMTP is configured (DB or env,
// see transporter.ts) the function returns false without throwing.
// Unlike an invite, there's no copy-paste fallback surfaced in the API
// response (a verification link isn't something the registering user
// already has any other way to get), so the register route also logs
// the link when SMTP isn't configured — see routes/auth/password.ts.

import { getTransporter } from './transporter.js';
import { escapeHtml } from '../utils/validate.js';

interface SendVerificationEmailArgs {
  to: string;
  verifyUrl: string;
}

export async function sendVerificationEmail(args: SendVerificationEmailArgs): Promise<boolean> {
  const resolved = await getTransporter();
  if (!resolved) return false;
  const { transporter, config } = resolved;

  // verifyUrl is always server-generated (env.publicUrl + a random hex
  // token — see routes/auth/password.ts), so there's no real injection
  // path here, but it's escaped anyway for consistency with
  // sendInvite.ts's html body and as cheap defense-in-depth.
  const safeUrl = escapeHtml(args.verifyUrl);

  const subject = 'Verify your email — Collaborative Brick Layout Designer';
  const text =
    `Welcome to Collaborative Brick Layout Designer!\n\n` +
    `Confirm your email address to finish setting up your account:\n\n${args.verifyUrl}\n\n` +
    `This link expires in 24 hours.\n`;
  const html =
    `<p>Welcome to Collaborative Brick Layout Designer!</p>` +
    `<p>Confirm your email address to finish setting up your account:</p>` +
    `<p><a href="${safeUrl}">Verify my email</a></p>` +
    `<p style="color:#888">Or paste this URL into your browser: ${safeUrl}</p>` +
    `<p style="color:#888">This link expires in 24 hours.</p>`;

  await transporter.sendMail({
    from: config.from,
    to: args.to,
    subject,
    text,
    html,
  });
  return true;
}
