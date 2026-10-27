import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn().mockResolvedValue(undefined);

vi.mock('./transporter.js', () => ({
  getTransporter: vi.fn().mockResolvedValue({
    transporter: { sendMail },
    config: { host: 'smtp.example.com', port: 587, user: null, pass: null, from: 'noreply@example.com', source: 'env' },
  }),
}));

const { sendInviteEmail } = await import('./sendInvite.js');

describe('sendInviteEmail — HTML-escapes user-controlled inviterName', () => {
  it('escapes an inviterName containing a script tag before it reaches the HTML body', async () => {
    sendMail.mockClear();
    await sendInviteEmail({
      to: 'victim@example.com',
      inviteUrl: 'https://app.example.com/invite/abc123',
      inviterName: '<script>alert(document.cookie)</script>',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0]![0] as { html: string; text: string; subject: string };
    expect(call.html).not.toContain('<script>');
    expect(call.html).toContain('&lt;script&gt;');
    // The plain-text part is not an HTML sink and should carry the raw name.
    expect(call.text).toContain('<script>alert(document.cookie)</script>');
  });

  it('escapes an inviterName that attempts attribute-breakout', async () => {
    sendMail.mockClear();
    await sendInviteEmail({
      to: 'victim@example.com',
      inviteUrl: 'https://app.example.com/invite/abc123',
      inviterName: '" onmouseover="alert(1)',
    });

    const call = sendMail.mock.calls[0]![0] as { html: string };
    expect(call.html).not.toContain('" onmouseover="alert(1)');
    expect(call.html).toContain('&quot; onmouseover=&quot;alert(1)');
  });

  it('renders a normal inviterName unescaped-looking (no stray entities)', async () => {
    sendMail.mockClear();
    await sendInviteEmail({
      to: 'victim@example.com',
      inviteUrl: 'https://app.example.com/invite/abc123',
      inviterName: 'Alice Wonderland',
    });

    const call = sendMail.mock.calls[0]![0] as { html: string };
    expect(call.html).toContain('Alice Wonderland invited you');
  });
});

describe('sendInviteEmail — says what the invite is for', () => {
  const sent = () => sendMail.mock.calls.at(-1)![0] as { html: string; text: string; subject: string };

  it('a club invite asks you to join the club, by name', async () => {
    await sendInviteEmail({ to: 'a@example.com', inviteUrl: 'https://app.example.com/org-invite/t', inviterName: 'Ann', what: 'club', name: 'Rail <Club>' });
    expect(sent().subject).toBe('Ann invited you to join Rail <Club>');
    expect(sent().text).toContain('Ann invited you to join the club Rail <Club> on Collaborative Brick Layout Designer.');
    expect(sent().html).toContain('join the club Rail &lt;Club&gt;');
    expect(sent().text).not.toContain('layout');
  });

  it('a hand-over asks you to take the layout', async () => {
    await sendInviteEmail({ to: 'a@example.com', inviteUrl: 'https://app.example.com/transfer/t', inviterName: 'Ann', what: 'transfer' });
    expect(sent().subject).toBe('Ann wants to hand a layout over to you');
    expect(sent().text).toContain('Ann wants to make you the owner of a Collaborative Brick Layout Designer layout.');
    expect(sent().text).not.toContain('collaborate');
  });

  it('a set is a set, a part a custom part', async () => {
    await sendInviteEmail({ to: 'a@example.com', inviteUrl: 'https://app.example.com/part-invite/t', inviterName: 'Ann', what: 'set' });
    expect(sent().subject).toBe('Ann invited you to a set');
    await sendInviteEmail({ to: 'a@example.com', inviteUrl: 'https://app.example.com/part-invite/t', inviterName: 'Ann', what: 'part' });
    expect(sent().subject).toBe('Ann invited you to a custom part');
  });
});
