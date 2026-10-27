// @vitest-environment jsdom
// Club logos on the web: the logo (or the club's first letter), and a
// club admin uploading and removing one from Manage › Settings.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { OrgDetail } from '../../api';
import { ClubLogo } from '../ClubLogo';
import { LogoSection } from '../ClubManage';

const ORG: OrgDetail = { id: 'o1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'admin', isAdmin: true, logoUrl: null };

let calls: { method: string; path: string; body: unknown }[];
let reply: { status: number; body: unknown };
beforeEach(() => {
  calls = [];
  reply = { status: 200, body: { ok: true, logoUrl: '/api/orgs/arklug/logo?v=1' } };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path: input, body: init?.body ? JSON.parse(init.body as string) : undefined });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('club logos', () => {
  it('shows the logo, or the club’s first letter without one', () => {
    show(
      <>
        <ClubLogo name="ArkLUG" logoUrl="/api/orgs/arklug/logo?v=1" />
        <ClubLogo name="rail club" logoUrl={null} />
      </>,
    );
    expect(screen.getByTestId('club-logo').getAttribute('src')).toBe('/api/orgs/arklug/logo?v=1');
    expect(screen.getByText('R')).toBeTruthy();
  });

  it('uploads a picture as base64 with its type, and says why one is refused', async () => {
    show(<LogoSection org={ORG} />);
    const input = screen.getByLabelText('Club logo file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })] } });
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    expect(calls[0]).toMatchObject({ path: '/api/orgs/arklug/logo', body: { mime: 'image/png', data: 'AQID' } });

    reply = { status: 400, body: { error: 'invalid_logo', message: 'This SVG can’t be used as a logo (it has a script). Try saving it as a PNG.' } };
    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    expect((await screen.findByRole('alert')).textContent).toContain('it has a script');

    // A file of another kind never leaves the browser.
    fireEvent.change(input, { target: { files: [new File(['GIF89a'], 'logo.gif', { type: 'image/gif' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Choose a PNG, JPEG, WebP or SVG'));
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });

  it('removes it', async () => {
    show(<LogoSection org={{ ...ORG, logoUrl: '/api/orgs/arklug/logo?v=1' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove logo' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/orgs/arklug/logo')).toBe(true));
  });
});
