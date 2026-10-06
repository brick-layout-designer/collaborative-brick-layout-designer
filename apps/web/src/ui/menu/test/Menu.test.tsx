// The Menu component: ARIA, keyboard, hover submenus, and the phone sheet
// with "‹ Back".

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '../Menu';
import { resolveMenu, type MenuEntry } from '../menuModel';

afterEach(cleanup);

function entries(spy: { find: () => void; grid: (v: boolean) => void; zoom: () => void }, gridOn = false) {
  const model: MenuEntry[] = [
    { kind: 'item', id: 'find', label: 'Find…', shortcut: 'Ctrl+F', onSelect: spy.find },
    { kind: 'separator' },
    {
      kind: 'submenu', id: 'view', label: 'View', items: [
        { kind: 'item', id: 'zoom', label: 'Zoom in', onSelect: spy.zoom },
        { kind: 'check', id: 'grid', label: 'Grid', checked: gridOn, onToggle: spy.grid },
      ],
    },
    { kind: 'item', id: 'off', label: 'Unavailable', onSelect: spy.find, enabled: () => false },
    { kind: 'item', id: 'prefs', label: 'Preferences…', onSelect: spy.find },
  ];
  return resolveMenu(model, undefined);
}
const spies = () => ({ find: vi.fn(), grid: vi.fn(), zoom: vi.fn() });
const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
const focused = () => document.activeElement?.textContent;
const trigger = () => screen.getByRole('button', { name: 'Map' });

describe('Menu with a mouse and keyboard', () => {
  it('opens from the button, names things for assistive tech, and shows shortcuts apart from labels', () => {
    render(<Menu label="Map" mode="popover" entries={entries(spies(), true)} />);
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Map' });
    expect(menu).toBeTruthy();
    const findItem = screen.getByRole('menuitem', { name: 'Find…' });
    expect(findItem.getAttribute('aria-keyshortcuts')).toBe('Control+F');
    expect(findItem.textContent).toContain('Ctrl+F');
    const view = screen.getByRole('menuitem', { name: 'View' });
    expect(view.getAttribute('aria-haspopup')).toBe('menu');
    expect(view.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('menuitem', { name: 'Unavailable' })).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
  });

  it('arrows move (skipping separators and disabled entries), → opens a submenu, ← and Esc close one level', () => {
    const s = spies();
    render(<Menu label="Map" mode="popover" entries={entries(s, true)} />);
    fireEvent.click(trigger());
    expect(focused()).toContain('Find…');
    key('ArrowDown');
    expect(focused()).toContain('View');
    key('ArrowDown');
    expect(focused()).toContain('Preferences…');
    key('ArrowDown');
    expect(focused()).toContain('Find…');
    key('End');
    expect(focused()).toContain('Preferences…');
    key('Home');
    key('ArrowUp');
    expect(focused()).toContain('Preferences…');
    key('ArrowUp');
    expect(focused()).toContain('View');

    key('ArrowRight');
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'View' }).getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toContain('Zoom in');
    key('ArrowDown');
    const grid = screen.getByRole('menuitemcheckbox', { name: 'Grid' });
    expect(document.activeElement).toBe(grid);
    expect(grid.getAttribute('aria-checked')).toBe('true');

    key('ArrowLeft');
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
    expect(focused()).toContain('View');
    key('ArrowRight');
    key('Escape');
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Map' })).toBeTruthy();
    key('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('Enter picks an item and closes; a tick flips', () => {
    const s = spies();
    render(<Menu label="Map" mode="popover" entries={entries(s, true)} />);
    fireEvent.click(trigger());
    // A keyboard Enter on a button is a click with no pointer (detail 0).
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }), { detail: 0 });
    expect(focused()).toContain('Zoom in');
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Grid' }), { detail: 0 });
    expect(s.grid).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('a submenu opens on hover and closes when another entry is hovered', () => {
    render(<Menu label="Map" mode="popover" entries={entries(spies())} />);
    fireEvent.click(trigger());
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'View' }), { pointerType: 'mouse' });
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Find…' }), { pointerType: 'mouse' });
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull();
  });

  it('a click outside closes it', () => {
    render(<><Menu label="Map" mode="popover" entries={entries(spies())} /><p>outside</p></>);
    fireEvent.click(trigger());
    act(() => {
      fireEvent.pointerDown(screen.getByText('outside'));
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a disabled entry does nothing', () => {
    const s = spies();
    render(<Menu label="Map" mode="popover" entries={entries(s)} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unavailable' }));
    expect(s.find).not.toHaveBeenCalled();
  });
});

describe('Menu on a phone', () => {
  it('is a bottom sheet; a submenu is a page with ‹ Back; rows are 44 px', () => {
    const s = spies();
    render(<Menu label="Map" mode="sheet" entries={entries(s)} />);
    fireEvent.click(trigger());
    expect(screen.getByTestId('menu-sheet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '‹ Back' })).toBeNull();
    const view = screen.getByRole('menuitem', { name: 'View' });
    expect(view.className).toContain('min-h-11');
    fireEvent.click(view);
    // The page replaces the top level.
    expect(screen.getByRole('menu', { name: 'View' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Find…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(screen.getByRole('menuitem', { name: 'Find…' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom in' }));
    expect(s.zoom).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('menu-sheet')).toBeNull();
  });

  it('Close shuts the sheet', () => {
    render(<Menu label="Map" mode="sheet" entries={entries(spies())} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(screen.queryByTestId('menu-sheet')).toBeNull();
  });
});
