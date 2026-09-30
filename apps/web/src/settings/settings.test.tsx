// Settings shows what people can change, and nothing held back for later
// (Expert mode is skipped in this first round of the redesign).

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SettingsContent } from './SettingsPage';

describe('Settings', () => {
  it('offers the look, colour, text size and help, without Expert mode', () => {
    render(
      <MemoryRouter>
        <SettingsContent />
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Look and feel').length).toBeGreaterThan(0);
    expect(screen.getByText('Bigger text and buttons')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Show help buttons' })).toBeTruthy();
    expect(screen.queryByText(/Expert mode/)).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Expert mode' })).toBeNull();
  });
});
