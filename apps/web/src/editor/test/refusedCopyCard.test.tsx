// The kept-copy card says why the server never got the changes
// (audit 2026-10-20: offline edits kept when signed out or the layout is gone).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Y from 'yjs';
import { RefusedCopies } from '../RefusedCopies';
import { dropRefusedCopy, keepRefusedCopy, useRefusedCopies, type RefusedWhy } from '../refusedCopies';

vi.mock('../../api', () => ({ api: { layouts: { get: () => Promise.reject(new Error('401')) } } }));

function docWithSomething(): Y.Doc {
  const d = new Y.Doc();
  d.getArray<string>('layers').push(['L']);
  return d;
}

function show(why: RefusedWhy) {
  keepRefusedCopy('X', docWithSomething(), why);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RefusedCopies />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const c of useRefusedCopies.getState().copies) dropRefusedCopy(c.key);
});

describe('kept copy card', () => {
  it('signed out: says so, and offers to save or download', () => {
    show('signed_out');
    expect(screen.getByText(/You were signed out before your latest changes/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save my copy as a new layout' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download it/ })).toBeTruthy();
  });

  it('layout gone: says so', () => {
    show('gone');
    expect(screen.getByText(/This layout was deleted, or is no longer shared with you/)).toBeTruthy();
  });

  it('an update the apps cannot read: says so', () => {
    show('unreadable');
    expect(screen.getByText(/they hold something the apps can't read/)).toBeTruthy();
    expect(screen.queryByText(/another layout's parts/)).toBeNull();
  });

  it('a refused merge keeps its own wording', () => {
    show('merge');
    expect(screen.getByText(/looked like another layout's parts going into it/)).toBeTruthy();
  });
});
