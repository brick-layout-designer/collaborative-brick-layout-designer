// The About page says plainly that the app is made with AI.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
