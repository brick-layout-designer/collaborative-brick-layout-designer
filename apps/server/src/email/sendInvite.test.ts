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
