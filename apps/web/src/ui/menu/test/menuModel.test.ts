// The menu model: predicates, separator tidying, ticks and shortcuts.

import { describe, expect, it, vi } from 'vitest';
import { activate, ariaKeyShortcut, nextFocusable, resolveMenu, type MenuEntry, type ResolvedEntry } from '../menuModel';
import { placeDropdown, placeSubmenu } from '../menuPlace';

type Ctx = { small: boolean };
const hideWhenSmall = (c: Ctx) => c.small;
const item = (id: string, extra: Partial<MenuEntry<Ctx>> = {}): MenuEntry<Ctx> =>
  ({ kind: 'item', id, label: id, onSelect: () => {}, ...extra }) as MenuEntry<Ctx>;
const sep: MenuEntry<Ctx> = { kind: 'separator' };
const kinds = (es: ResolvedEntry[]) => es.map((e) => (e.kind === 'separator' ? '—' : e.id));

describe('resolveMenu', () => {
  it('drops hidden entries and never leaves two separators in a row, or one at either end', () => {
    const entries = [sep, item('a'), sep, item('b', { hidden: hideWhenSmall }), sep, item('c'), sep, item('d', { hidden: hideWhenSmall }), sep];
    expect(kinds(resolveMenu(entries, { small: false }))).toEqual(['a', '—', 'b', '—', 'c', '—', 'd']);
    expect(kinds(resolveMenu(entries, { small: true }))).toEqual(['a', '—', 'c']);
  });

  it('drops a hidden submenu, and a submenu left empty', () => {
    const entries: MenuEntry<Ctx>[] = [
      item('a'),
      { kind: 'submenu', id: 'sub', label: 'Sub', hidden: hideWhenSmall, items: [item('s1')] },
      { kind: 'submenu', id: 'empty', label: 'Empty', items: [item('e1', { hidden: hideWhenSmall }), sep] },
    ];
    expect(kinds(resolveMenu(entries, { small: false }))).toEqual(['a', 'sub', 'empty']);
    expect(kinds(resolveMenu(entries, { small: true }))).toEqual(['a']);
  });

  it('applies the enabled predicate', () => {
    const r = resolveMenu([item('a', { enabled: (c: Ctx) => !c.small })], { small: true });
    expect(r[0]).toMatchObject({ id: 'a', disabled: true });
    expect(resolveMenu([item('a', { enabled: (c: Ctx) => !c.small })], { small: false })[0]).toMatchObject({ disabled: false });
  });

  it('keeps a tick’s state and its shortcut apart from the label', () => {
    const onToggle = vi.fn();
    const [c] = resolveMenu<Ctx>([{ kind: 'check', id: 'g', label: 'Grid', shortcut: 'G', checked: true, onToggle }], { small: false });
    expect(c).toMatchObject({ kind: 'check', label: 'Grid', shortcut: 'G', checked: true });
    activate(c!);
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});

describe('activate', () => {
  it('fires an item, not a disabled one, a submenu or a separator', () => {
    const onSelect = vi.fn();
    const [on, off] = resolveMenu<Ctx>([item('a', { onSelect }), item('b', { onSelect, enabled: () => false })], { small: false });
    expect(activate(on!)).toBe(true);
    expect(activate(off!)).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(activate({ kind: 'separator', id: 's' })).toBe(false);
    expect(activate({ kind: 'submenu', id: 's', label: 'S', disabled: false, items: [] })).toBe(false);
  });
});

describe('nextFocusable', () => {
  const list = resolveMenu<Ctx>([item('a'), sep, item('b', { enabled: () => false }), item('c')], { small: false });
  it('skips separators and disabled entries, and wraps', () => {
    expect(list[nextFocusable(list, 0, 1)]!.id).toBe('c');
    expect(list[nextFocusable(list, 3, 1)]!.id).toBe('a');
    expect(list[nextFocusable(list, 0, -1)]!.id).toBe('c');
    expect(list[nextFocusable(list, -1, 1)]!.id).toBe('a');
  });
  it('is -1 with nothing to focus', () => {
    expect(nextFocusable(resolveMenu<Ctx>([item('x', { enabled: () => false })], { small: false }), 0, 1)).toBe(-1);
  });
});

describe('ariaKeyShortcut', () => {
  it('names keys the way aria-keyshortcuts does', () => {
    expect(ariaKeyShortcut('Ctrl+F')).toBe('Control+F');
    expect(ariaKeyShortcut('⌘+,')).toBe('Meta+Comma');
    expect(ariaKeyShortcut('Ctrl+=')).toBe('Control+Equal');
    expect(ariaKeyShortcut('Ctrl+-')).toBe('Control+Minus');
    expect(ariaKeyShortcut('F')).toBe('F');
  });
});

describe('placing', () => {
  const item = { left: 100, right: 300, top: 200, bottom: 230 };
  it('puts a submenu to the right of its item when there is room', () => {
    const p = placeSubmenu(item, 220, 150, 1200, 800);
    expect(p.flipped).toBe(false);
    expect(p.left).toBe(298);
  });
  it('flips a submenu to the left near the right edge of the window', () => {
    const p = placeSubmenu({ left: 700, right: 900, top: 200, bottom: 230 }, 220, 150, 1000, 800);
    expect(p.flipped).toBe(true);
    expect(p.left).toBe(482);
  });
  it('moves a submenu up rather than past the bottom', () => {
    const p = placeSubmenu({ left: 0, right: 200, top: 700, bottom: 730 }, 220, 300, 1200, 800);
    expect(p.top).toBe(496);
  });
  it('keeps the dropdown inside the window', () => {
    expect(placeDropdown({ left: 950, right: 1000, top: 10, bottom: 40 }, 220, 1000, 800).left).toBe(776);
    expect(placeDropdown({ left: 50, right: 100, top: 10, bottom: 40 }, 220, 1000, 800)).toEqual({ left: 50, top: 44, maxHeight: 748 });
  });
});
