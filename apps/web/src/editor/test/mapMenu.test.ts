// The Map menu's structure: groups, the module editor's cut-down menu,
// ticks and shortcuts.

import { describe, expect, it, vi } from 'vitest';
import { mapMenuEntries, modKey, type MapMenuActions, type MapMenuToggles } from '../mapMenu';
import { activate, resolveMenu, type ResolvedEntry } from '../../ui/menu/menuModel';

function setup(moduleMode = false) {
  const actions = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (t, k: string) => (t[k] ??= vi.fn()),
  });
  const set = vi.fn();
  const toggles = new Proxy({} as Record<string, { on: boolean; set: typeof set }>, {
    get: (_t, k: string) => ({ on: k === 'grid' || k === 'budgetNumbers', set: (v: boolean) => set(k, v) }),
  });
  const menu = resolveMenu(mapMenuEntries(actions as unknown as MapMenuActions, toggles as unknown as MapMenuToggles, 'Ctrl'), { moduleMode });
  return { menu, actions, set };
}

const outline = (es: ResolvedEntry[]): unknown[] =>
  es.map((e) => (e.kind === 'separator' ? '—' : e.kind === 'submenu' ? { [e.label]: outline(e.items) } : e.label));
const find = (es: ResolvedEntry[], ...path: string[]): ResolvedEntry => {
  let list = es;
  let found: ResolvedEntry | undefined;
  for (const label of path) {
    found = list.find((e) => e.kind !== 'separator' && e.label === label);
    if (!found) throw new Error(`no ${label}`);
    if (found.kind === 'submenu') list = found.items;
  }
  return found!;
};
const noDoubleSeparators = (es: ResolvedEntry[]): boolean =>
  es.every((e, i) => !(e.kind === 'separator' && (i === 0 || i === es.length - 1 || es[i - 1]!.kind === 'separator'))) &&
  es.every((e) => e.kind !== 'submenu' || noDoubleSeparators(e.items));

describe('Map menu', () => {
  it('has a short top level, grouped like the desktop', () => {
    const { menu } = setup();
    expect(outline(menu).map((e) => (typeof e === 'object' && e !== null ? Object.keys(e)[0] : e))).toEqual([
      'General info…', 'Background colour…', 'Background image…', 'Find…', '—',
      'Insert', 'Modules & sets', 'Venue', 'View', 'Budget', 'Download & export', '—',
      'Preferences…',
    ]);
    expect(outline(find(menu, 'Venue').kind === 'submenu' ? (find(menu, 'Venue') as { items: ResolvedEntry[] }).items : [])).toEqual([
      'Open venue designer…', '—', 'Draw outline…', 'Draw outline by dimensions…', 'Add obstacle…', '—',
      'Edit venue properties…', 'Save to venue library…', 'Export venue as file…', 'Load venue from file…', '—', 'Clear venue…',
    ]);
    expect(noDoubleSeparators(menu)).toBe(true);
  });

  it('in the module editor: no Venue, no Budget, no Download layout, and no double separators', () => {
    const { menu } = setup(true);
    const top = outline(menu).map((e) => (typeof e === 'object' && e !== null ? Object.keys(e)[0] : e));
    expect(top).not.toContain('Venue');
    expect(top).not.toContain('Budget');
    expect(top).toContain('View');
    expect(outline((find(menu, 'Download & export') as { items: ResolvedEntry[] }).items)).toEqual([
      'Download as…', '—', 'Export as image…', 'Export part list…',
    ]);
    expect(noDoubleSeparators(menu)).toBe(true);
  });

  it('shows shortcuts beside the label, not in it', () => {
    const { menu } = setup();
    expect(find(menu, 'Find…')).toMatchObject({ label: 'Find…', shortcut: 'Ctrl+F' });
    expect(find(menu, 'Insert', 'Text…')).toMatchObject({ shortcut: 'Ctrl+T' });
    expect(find(menu, 'Insert', 'Anchored label…')).toMatchObject({ shortcut: 'Ctrl+L' });
    expect(find(menu, 'View', 'Fit to view')).toMatchObject({ shortcut: 'F' });
    expect(find(menu, 'Preferences…')).toMatchObject({ shortcut: 'Ctrl+,' });
    expect(modKey('MacIntel')).toBe('⌘');
    expect(modKey('Linux x86_64')).toBe('Ctrl');
  });

  it('ticks show the current state and flip it', () => {
    const { menu, set } = setup();
    const grid = find(menu, 'View', 'Grid');
    const hulls = find(menu, 'View', 'Brick hulls');
    const electric = find(menu, 'View', 'Electric circuits');
    expect(grid).toMatchObject({ kind: 'check', checked: true });
    expect(hulls).toMatchObject({ kind: 'check', checked: false });
    expect(electric).toMatchObject({ kind: 'check', checked: false });
    activate(grid);
    activate(hulls);
    expect(set).toHaveBeenCalledWith('grid', false);
    expect(set).toHaveBeenCalledWith('brickHulls', true);
    expect(find(menu, 'Budget', 'Show budget numbers')).toMatchObject({ checked: true });
    activate(find(menu, 'Budget', 'Stop at the budget limits'));
    expect(set).toHaveBeenCalledWith('budgetLimit', true);
  });

  it('each entry runs its own action', () => {
    const { menu, actions } = setup();
    activate(find(menu, 'Venue', 'Clear venue…'));
    activate(find(menu, 'Modules & sets', 'Save selection as set…'));
    activate(find(menu, 'Download & export', 'Download layout (.bld-layout)'));
    expect(actions.venueClear).toHaveBeenCalledTimes(1);
    expect(actions.saveAsSet).toHaveBeenCalledTimes(1);
    expect(actions.downloadLayout).toHaveBeenCalledTimes(1);
    expect(actions.saveModule).not.toHaveBeenCalled();
  });
});
