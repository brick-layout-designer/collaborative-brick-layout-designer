// Settings shows what people can change, and nothing held back for later
// (Expert mode is skipped in this first round of the redesign).

import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('offers the Snap strength under Editing, Gentle until changed', () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsContent />
      </MemoryRouter>,
    );
    const view = within(container);
    expect(view.getAllByText('Editing').length).toBeGreaterThan(0);
    const group = view.getByRole('radiogroup', { name: 'Snap strength' });
    const radios = group.querySelectorAll('[role="radio"]');
    expect([...radios].map((r) => r.querySelector('span')?.textContent)).toEqual(['Off', 'Gentle', 'Strong']);
    expect(view.getByTestId('snap-strength-gentle').getAttribute('aria-checked')).toBe('true');
    expect(view.getByTestId('snap-strength-strong').getAttribute('aria-checked')).toBe('false');
  });
});
