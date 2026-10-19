// Admin › Audit log says in words when the live editor refused (or let
// through but flagged) an update that would mix another layout in.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../api', () => ({
  api: {
    admin: {
      auditLog: async () => ({
        total: 2,
        limit: 50,
        offset: 0,
        events: [
          {
            id: 1,
            layoutId: 'layout-b',
            resourceKind: null,
            resourceId: null,
            userId: 'u1',
            userName: 'Aaron',
            eventType: 'layout_merge_refused',
            payload: { foreignLayers: 7, unseenClients: 3, client: 'BrickLayoutDesigner/1.2.0 (desktop)' },
            createdAt: Date.now(),
          },
          {
            id: 2,
            layoutId: 'layout-c',
            resourceKind: null,
            resourceId: null,
            userId: 'u1',
            userName: 'Aaron',
            eventType: 'layout_merge_suspected',
            payload: { foreignLayers: 0, unseenClients: 5 },
            createdAt: Date.now(),
          },
        ],
      }),
    },
  },
}));

const { AuditTab } = await import('../AuditTab');

describe('AuditTab', () => {
  it('describes merge refusals and flags in plain words', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuditTab />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        'Refused a live update that would have mixed another layout into this one: it brought 7 layers from elsewhere (from BrickLayoutDesigner/1.2.0 (desktop)). Nothing was changed, and that connection was closed.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/came from 5 editors this layout had never seen at once/)).toBeTruthy();
  });
});
