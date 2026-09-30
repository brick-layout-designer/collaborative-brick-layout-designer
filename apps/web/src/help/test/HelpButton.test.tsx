// The "?" button: quiet at rest, a one-sentence tooltip on hover or
// keyboard focus, a popover with more on click, Esc back to the button,
// and gone when Settings > Show help buttons is off.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpButton } from '../HelpButton';
import { HELP_TEXTS } from '../helpTexts';
import { PrefsContext, type PrefsContextValue } from '../../theme/PrefsProvider';
import { DEFAULT_PREFERENCES } from '../../theme/theme';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SNAP = HELP_TEXTS['toolbar.snap'];

function withPrefs(helpIcons: boolean, ui: React.ReactNode) {
  const value: PrefsContextValue = {
    prefs: { ...DEFAULT_PREFERENCES, helpIcons },
    mode: 'light',
    setPrefs: () => {},
    syncedToAccount: false,
    updatedAt: null,
  };
  return <PrefsContext.Provider value={value}>{ui}</PrefsContext.Provider>;
}

function setup(helpIcons = true) {
  const onOuterKey = vi.fn();
  render(
    withPrefs(
      helpIcons,
      <div onKeyDown={onOuterKey}>
        <label data-testid="snap-control">
          Snap <select aria-label="Snap step" />
        </label>
        <HelpButton helpKey="toolbar.snap" />
        <button type="button">Somewhere else</button>
        <p>Empty space</p>
      </div>,
    ),
  );
  return { onOuterKey };
}

const helpButton = () => screen.getByRole('button', { name: `Help: ${SNAP.title}` });

describe('HelpButton', () => {
  it('is a quiet button with a name at rest: no tooltip, no popover', () => {
    setup();
    const b = helpButton();
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the one-sentence tooltip on hover, and hides it when the pointer leaves', () => {
    setup();
    const b = helpButton();
    fireEvent.pointerEnter(b, { pointerType: 'mouse' });
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe(SNAP.short);
    expect(b.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.pointerLeave(b, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the tooltip when reached with the keyboard', async () => {
    setup();
    const user = userEvent.setup();
    await user.tab(); // the select
    await user.tab(); // the "?"
    expect(document.activeElement).toBe(helpButton());
    expect(screen.getByRole('tooltip').textContent).toBe(SNAP.short);
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens the popover with the longer text on click, with Show me', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(helpButton());
    const pop = screen.getByRole('dialog', { name: SNAP.title });
    expect(pop.textContent).toContain(SNAP.more);
    expect(screen.getByRole('button', { name: 'Show me' })).toBeTruthy();
    expect(helpButton().getAttribute('aria-expanded')).toBe('true');
    // The tooltip gives way to the popover.
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Focus moves into the popover so the keyboard can reach its buttons.
    expect(pop.contains(document.activeElement)).toBe(true);
  });

  it('closes on Esc and puts focus back on the "?", without passing Esc on', async () => {
    const { onOuterKey } = setup();
    const user = userEvent.setup();
    await user.click(helpButton());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(helpButton());
    // Coming back to the button doesn't bring the tooltip straight back.
    expect(screen.queryByRole('tooltip')).toBeNull();
    // The dialog or editor underneath never saw the Esc.
    expect(onOuterKey.mock.calls.some(([e]) => (e as KeyboardEvent).key === 'Escape')).toBe(false);
  });

  it('works from the keyboard alone: Enter opens, Tab reaches Show me, Esc closes', async () => {
    setup();
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: SNAP.title })).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show me' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(helpButton());
  });

  it('closes when you click or tap somewhere else, even on empty space', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(helpButton());
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.click(screen.getByText('Empty space'));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(helpButton());
    await user.click(screen.getByRole('button', { name: 'Somewhere else' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Show me pulses the outline of the control it explains', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(helpButton());
    await user.click(screen.getByRole('button', { name: 'Show me' }));
    const control = screen.getByTestId('snap-control');
    expect(control.classList.contains('help-pulse')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => void vi.advanceTimersByTime(3000));
    expect(control.classList.contains('help-pulse')).toBe(false);
  });

  it('offers Learn more only when there is a help page for it', async () => {
    const user = userEvent.setup();
    render(withPrefs(true, <HelpButton helpKey="panel.sheets" />));
    await user.click(screen.getByRole('button', { name: /^Help:/ }));
    const link = screen.getByRole('link', { name: 'Learn more' });
    expect(link.getAttribute('href')).toBe(HELP_TEXTS['panel.sheets'].learnMoreUrl);
    cleanup();
    render(withPrefs(true, <HelpButton helpKey="toolbar.snap" />));
    await user.click(screen.getByRole('button', { name: /^Help:/ }));
    expect(screen.queryByText('Learn more')).toBeNull();
  });

  it('is not shown at all while help buttons are turned off', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: /^Help:/ })).toBeNull();
    expect(document.querySelector('[data-help-key]')).toBeNull();
  });
});
