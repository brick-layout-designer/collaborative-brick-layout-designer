// Best-effort invite email via SMTP.
//
// Per PLAN.md decision: "copy-paste link by default, SMTP if configured".
// When no SMTP is configured (DB or env, see transporter.ts) the
// function returns false without throwing — the inviter still gets the
// URL in the API response and copy-pastes it.

import { getTransporter } from './transporter.js';
import { escapeHtml } from '../utils/validate.js';

interface SendInviteEmailArgs {
  to: string;
  inviteUrl: string;
  inviterName: string;
}

export async function sendInviteEmail(args: SendInviteEmailArgs): Promise<boolean> {
  const resolved = await getTransporter();
  if (!resolved) return false;
  const { transporter, config } = resolved;

  // inviterName is a user-controlled displayName (now user-editable —
  // see PATCH /api/auth/me) and inviteUrl, while server-generated, is
  // still escaped here for defense-in-depth in the attribute context.
  // `text` needs no escaping — it's a plain-text MIME part, not markup.
  const safeName = escapeHtml(args.inviterName);
  const safeUrl = escapeHtml(args.inviteUrl);

  const subject = `${args.inviterName} invited you to a layout`;
  const text =
    `${args.inviterName} invited you to collaborate on a Collaborative ` +
    `Layout Designer layout.\n\nOpen this link to accept:\n\n${args.inviteUrl}\n`;
  const html =
    `<p>${safeName} invited you to collaborate on a ` +
    `Collaborative Brick Layout Designer layout.</p>` +
    `<p><a href="${safeUrl}">Open in Collaborative Brick Layout Designer</a></p>` +
    `<p style="color:#888">Or paste this URL into your browser: ${safeUrl}</p>`;

  await transporter.sendMail({
    from: config.from,
    to: args.to,
    subject,
    text,
    html,
  });
  return true;
}
