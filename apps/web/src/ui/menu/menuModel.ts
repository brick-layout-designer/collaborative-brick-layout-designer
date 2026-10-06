// A menu as data: items, ticks, separators and submenus, with the
// keyboard shortcut kept apart from the label and "is it shown / can it
// be used" as predicates over a context (the module editor hides the
// venue, say). `resolveMenu` turns that into what is drawn: hidden
// entries gone, empty submenus gone, and never two separators in a row
// or one at either end.

export interface MenuItem<C> {
  kind: 'item';
  /** Stable and unique among its siblings (keys, tests). */
  id: string;
  label: string;
  /** Shown right-aligned and muted, e.g. "Ctrl+F". */
  shortcut?: string;
  onSelect: () => void;
  hidden?: (ctx: C) => boolean;
  enabled?: (ctx: C) => boolean;
}

export interface MenuCheck<C> {
  kind: 'check';
  id: string;
  label: string;
  shortcut?: string;
  checked: boolean;
  /** Called with the new state. */
  onToggle: (checked: boolean) => void;
  hidden?: (ctx: C) => boolean;
  enabled?: (ctx: C) => boolean;
}

export interface MenuSubmenu<C> {
  kind: 'submenu';
  id: string;
  label: string;
  items: MenuEntry<C>[];
  hidden?: (ctx: C) => boolean;
  enabled?: (ctx: C) => boolean;
}

export interface MenuSeparator<C> {
  kind: 'separator';
  hidden?: (ctx: C) => boolean;
}

export type MenuEntry<C = void> = MenuItem<C> | MenuCheck<C> | MenuSubmenu<C> | MenuSeparator<C>;

/** An entry as drawn: predicates applied. */
export type ResolvedEntry =
  | { kind: 'item'; id: string; label: string; shortcut?: string | undefined; disabled: boolean; onSelect: () => void }
  | { kind: 'check'; id: string; label: string; shortcut?: string | undefined; disabled: boolean; checked: boolean; onToggle: (checked: boolean) => void }
  | { kind: 'submenu'; id: string; label: string; disabled: boolean; items: ResolvedEntry[] }
  | { kind: 'separator'; id: string };

/** The entries shown for `ctx`, with separators tidied and empty submenus dropped. */
export function resolveMenu<C>(entries: readonly MenuEntry<C>[], ctx: C): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const e of entries) {
    if (e.hidden?.(ctx)) continue;
    switch (e.kind) {
      case 'separator':
        // Never first, never after another separator.
        if (out.length > 0 && out[out.length - 1]!.kind !== 'separator') out.push({ kind: 'separator', id: `sep-${out.length}` });
        break;
      case 'item':
        out.push({ kind: 'item', id: e.id, label: e.label, shortcut: e.shortcut, disabled: e.enabled ? !e.enabled(ctx) : false, onSelect: e.onSelect });
        break;
      case 'check':
        out.push({
          kind: 'check', id: e.id, label: e.label, shortcut: e.shortcut,
          disabled: e.enabled ? !e.enabled(ctx) : false, checked: e.checked, onToggle: e.onToggle,
        });
        break;
      case 'submenu': {
        const items = resolveMenu(e.items, ctx);
        if (items.length === 0) break;
        out.push({ kind: 'submenu', id: e.id, label: e.label, disabled: e.enabled ? !e.enabled(ctx) : false, items });
        break;
      }
    }
  }
  // Never last.
  while (out.length > 0 && out[out.length - 1]!.kind === 'separator') out.pop();
  return out;
}

/** Runs an entry's action: a tick flips, an item fires. Submenus and separators do nothing. */
export function activate(e: ResolvedEntry): boolean {
  if (e.kind === 'separator' || e.kind === 'submenu' || e.disabled) return false;
  if (e.kind === 'check') e.onToggle(!e.checked);
  else e.onSelect();
  return true;
}

/**
 * "Ctrl+Shift+F" as `aria-keyshortcuts` wants it ("Control+Shift+F").
 * Mac users see ⌘ in the label; the attribute names the key the same way.
 */
export function ariaKeyShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((k) => (k === 'Ctrl' ? 'Control' : k === 'Cmd' || k === '⌘' ? 'Meta' : k === '=' ? 'Equal' : k === '-' ? 'Minus' : k === ',' ? 'Comma' : k))
    .join('+');
}

/** Index of the next usable entry from `from` going `dir`, wrapping; -1 when none. */
export function nextFocusable(entries: readonly ResolvedEntry[], from: number, dir: 1 | -1): number {
  const n = entries.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n;
    const e = entries[i]!;
    if (e.kind !== 'separator' && !e.disabled) return i;
  }
  return -1;
}
