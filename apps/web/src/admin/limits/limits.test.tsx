import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describeEvent, formatLimit, toInput, toStored } from './limitsApi';
import { GlobalLimitsForm, HeavyUseTab } from './LimitsUi';

afterEach(cleanup);

describe('limit values in forms', () => {
  it('types sizes in MB and stores bytes', () => {
    expect(toStored('500', 'bytes')).toBe(500 * 1024 * 1024);
    expect(toStored('0.5', 'bytes')).toBe(512 * 1024);
    expect(toStored('12', 'count')).toBe(12);
    expect(toStored('', 'count')).toBeNull();
    expect(toStored('-1', 'count')).toBeNaN();
    expect(toStored('lots', 'bytes')).toBeNaN();
    expect(toInput(2 * 1024 ** 3, 'bytes')).toBe('2048');
  });

  it('reads limits out in plain words', () => {
    expect(formatLimit(10 * 1024 ** 3, 'bytes')).toBe('10 GB');
    expect(formatLimit(256 * 1024 ** 2, 'bytes')).toBe('256 MB');
    expect(formatLimit(1200, 'per_minute')).toBe('1,200 a minute');
    expect(formatLimit(500, 'count')).toBe('500');
  });

  it('describes activity', () => {
    expect(describeEvent({ id: 1, at: 0, eventType: 'create', kind: 'layout', actor: 'Ada', name: 'Harbour' })).toBe('Ada created “Harbour”');
    expect(describeEvent({ id: 2, at: 0, eventType: 'admin_suspend', kind: 'user', actor: 'Root', name: null })).toBe('Root turned on read-only for a person');
    expect(describeEvent({ id: 3, at: 0, eventType: 'settings', kind: 'org', actor: null, name: null })).toBe('Someone changed the settings of a club');
  });
});

describe('Heavy use tab', () => {
  it('flags people far above the usual and shows read-only', async () => {
    const rows = [
      { id: 'a', name: 'Ada', email: 'a@x', createdAt: 0, suspended: true, storageBytes: 2048, layouts: 3, customParts: 0, modules: 0, rooms: 0, shareLinks: 0, uploads1d: 0, uploads7d: 40, uploadsPrev7d: 2, requests1d: 9000, requestsPrev1d: 100, refused7d: 0, shareViews7d: 0, live: 1, flags: ['requests 30× usual'] },
    ];
    globalThis.fetch = (async () => new Response(JSON.stringify({ sort: 'storageBytes', total: 1, flagged: 1, rows }), { status: 200 })) as typeof fetch;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HeavyUseTab onOpen={() => {}} />
      </QueryClientProvider>,
    );
    expect((await screen.findAllByText('requests 30× usual')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('🔒 Read-only').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 flagged of 1').length).toBe(2);
  });
});

describe('Enforce usage limits switch', () => {
  function serve(page: Record<string, unknown>) {
    const patches: unknown[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(init.body as string));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ limits: [], ...page }), { status: 200 });
    }) as typeof fetch;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GlobalLimitsForm />
      </QueryClientProvider>,
    );
    return patches;
  }

  it('turns limits off from Settings', async () => {
    const patches = serve({ enforced: true, enforcedSetting: true, enforcementSource: 'setting' });
    const sw = (await screen.findByRole('switch', { name: 'Enforce usage limits' })) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    await waitFor(() => expect(patches).toEqual([{ limitsEnforced: false }]));
  });

  it("says when the server's setting forces it, and can't be changed here", async () => {
    serve({ enforced: false, enforcedSetting: true, enforcementSource: 'forced-off' });
    const sw = (await screen.findByRole('switch', { name: 'Enforce usage limits' })) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    expect(sw.checked).toBe(false);
    expect(screen.getByTestId('limits-forced').textContent).toMatch(/Forced off by the server setting/);
    expect(screen.getByTestId('limits-off')).toBeTruthy();
  });
});

