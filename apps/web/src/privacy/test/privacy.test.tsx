// Profile › Your data and Admin › Settings › Privacy, against a stubbed fetch.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MyDataSection } from '../MyDataSection';
import { PrivacySettingsSection } from '../PrivacySettings';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (url: string, init?: RequestInit) => unknown;
function stubFetch(handler: Handler) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const out = handler(url, init);
      if (out instanceof Response) return out;
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

const HOUR = 3600_000;

describe('Your data', () => {
  it('asks for a download, then shows it ready with a Download link', async () => {
    let asked = false;
    const calls = stubFetch((url, init) => {
      if (init?.method === 'POST') {
        asked = true;
        return { export: { id: 'e1', status: 'building' } };
      }
      return {
        exports: asked
          ? [{ id: 'e1', status: 'ready', sizeBytes: 2_500_000, error: null, createdAt: Date.now(), readyAt: Date.now(), expiresAt: Date.now() + 7 * 24 * HOUR, downloadedAt: null, downloadUrl: '/api/privacy/exports/e1/download' }]
          : [],
        nextAllowedAt: null,
        everyHours: 24,
        keepDays: 7,
        maxMb: 1024,
      };
    });
    wrap(<MyDataSection />);
    const button = await screen.findByRole('button', { name: 'Download my data' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/kept for 7 days/)).toBeTruthy();
    fireEvent.click(button);
    const link = await screen.findByRole('link', { name: 'Download' });
    expect(link.getAttribute('href')).toBe('/api/privacy/exports/e1/download');
    expect(screen.getByText(/2\.4 MB/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/me/privacy/exports')).toBe(true);
  });

  it('says when you can ask again, and the button waits', async () => {
    const later = Date.now() + 5 * HOUR;
    stubFetch(() => ({ exports: [], nextAllowedAt: later, everyHours: 24, keepDays: 7, maxMb: 1024 }));
    wrap(<MyDataSection />);
    expect(await screen.findByText(/You can ask again after/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Download my data' }) as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
  });

  it('shows why a download failed', async () => {
    stubFetch(() => ({
      exports: [{ id: 'e2', status: 'failed', sizeBytes: null, error: 'The download would be bigger than 10 MB, the site’s limit.', createdAt: Date.now(), readyAt: null, expiresAt: null, downloadedAt: null, downloadUrl: null }],
      nextAllowedAt: null,
      everyHours: 24,
      keepDays: 7,
      maxMb: 10,
    }));
    wrap(<MyDataSection />);
    expect(await screen.findByText(/bigger than 10 MB/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });
});

const STATE = (over: object) => ({
  key: 'exportKeepDays',
  label: 'Keep a data download for',
  help: 'After this the download link stops working.',
  unit: 'days',
  builtIn: 7,
  min: 1,
  max: 30,
  envVar: 'PRIVACY_EXPORT_KEEP_DAYS',
  value: 7,
  setting: null,
  forcedBy: null,
  ...over,
});

describe('Admin › Settings › Privacy', () => {
  it('saves a new value, and can go back to the default', async () => {
    let saved: unknown = null;
    stubFetch((_url, init) => {
      if (init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body));
        return { ok: true };
      }
      return { privacy: { settings: [STATE({ value: 3, setting: 3 })] } };
    });
    wrap(<PrivacySettingsSection />);
    const input = await screen.findByLabelText('Keep a data download for');
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saved).toEqual({ privacy: { exportKeepDays: 10 } }));
    fireEvent.click(screen.getByRole('button', { name: /Back to the default \(7\)/ }));
    await waitFor(() => expect(saved).toEqual({ privacy: { exportKeepDays: null } }));
  });

  it('refuses a value out of range', async () => {
    stubFetch(() => ({ privacy: { settings: [STATE({})] } }));
    wrap(<PrivacySettingsSection />);
    const input = await screen.findByLabelText('Keep a data download for');
    fireEvent.change(input, { target: { value: '99' } });
    expect(screen.getByText('Between 1 and 30.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('says when the server forces a value, and locks the box', async () => {
    stubFetch(() => ({ privacy: { settings: [STATE({ value: 14, forcedBy: 'PRIVACY_EXPORT_KEEP_DAYS' })] } }));
    wrap(<PrivacySettingsSection />);
    const input = await screen.findByLabelText('Keep a data download for');
    expect((input as HTMLButtonElement | HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Forced by the server setting/).textContent).toContain('PRIVACY_EXPORT_KEEP_DAYS');
  });
});
