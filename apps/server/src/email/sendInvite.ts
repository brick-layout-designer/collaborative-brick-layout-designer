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
  /**
   * What they're invited to (default a layout): to work on a layout,
   * module, custom part or set; to join a club; or to take a layout
   * handed over to them.
   */
  what?: 'layout' | 'module' | 'part' | 'set' | 'club' | 'transfer';
  /** The club's name, for a club invite. */
  name?: string;
}

const APP = 'Collaborative Brick Layout Designer';

/** The subject and the sentence the email opens with, in plain text. */
function wording(args: SendInviteEmailArgs): { subject: string; line: (who: string, name: string) => string } {
  switch (args.what) {
    case 'club':
      return {
        subject: `${args.inviterName} invited you to join ${args.name || 'a club'}`,
        line: (who, name) => (name ? `${who} invited you to join the club ${name} on ${APP}.` : `${who} invited you to join a club on ${APP}.`),
      };
    case 'transfer':
      return {
        subject: `${args.inviterName} wants to hand a layout over to you`,
        line: (who) => `${who} wants to make you the owner of a ${APP} layout.`,
      };
    default: {
      const what = args.what === 'part' ? 'custom part' : (args.what ?? 'layout');
      return { subject: `${args.inviterName} invited you to a ${what}`, line: (who) => `${who} invited you to collaborate on a ${APP} ${what}.` };
    }
  }
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

  const { subject, line } = wording(args);
  const text = `${line(args.inviterName, args.name ?? '')}\n\nOpen this link to accept:\n\n${args.inviteUrl}\n`;
  const html =
    `<p>${line(safeName, escapeHtml(args.name ?? ''))}</p>` +
    `<p><a href="${safeUrl}">Open in ${APP}</a></p>` +
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
