// The About page says plainly that the app is made with AI.

import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AboutPage } from '../AboutPage';

describe('About page', () => {
  it('says the app is made with AI', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AboutPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Made with AI' })).toBeTruthy();
    expect(screen.getByText(/written with the help of AI \(Anthropic's Claude\)/)).toBeTruthy();
  });
});

describe('About page privacy note', () => {
  it('says what the server counts and for how long', () => {
    cleanup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <AboutPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'What the server counts' })).toBeTruthy();
    expect(screen.getByText(/does not record which pages you visit or your IP address/)).toBeTruthy();
    expect(screen.getByText(/about 13 months/)).toBeTruthy();
  });
});
