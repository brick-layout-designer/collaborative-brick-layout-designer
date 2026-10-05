// Theme logic with no React in it: which mode "system" means right now,
// the CSS variables an accent sets, and applying the preferences to the
// <html> element. index.html runs a copy of `applyCached` before the app
// loads so a dark-theme user never sees a flash of light.

import { ACCENTS, ACCENT_IDS, LARGE_TEXT_SCALE, NEUTRALS, type AccentId, type Mode } from './tokens';

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'dark', 'system'];

/** The settings stored on the account (GET/PUT /api/me/preferences). */
export interface Preferences {
  theme: ThemeChoice;
  accent: AccentId;
  largeText: boolean;
  expertMode: boolean;
  helpIcons: boolean;
  toursSeen: string[];
  /** Picture size in the editor's parts and module lists (32–160 px); absent until set. */
  partsIconSize?: number;
}

export const PARTS_ICON_MIN = 32;
export const PARTS_ICON_MAX = 160;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  accent: 'brick',
  largeText: false,
  expertMode: false,
  helpIcons: true,
  toursSeen: [],
};

/** localStorage key for the last-known preferences (signed out, and pre-paint). */
export const PREFS_CACHE_KEY = 'bld.prefs';

/** "system" follows the computer; light and dark are fixed. */
export function resolveMode(choice: ThemeChoice, systemDark: boolean): Mode {
  if (choice === 'system') return systemDark ? 'dark' : 'light';
  return choice;
}

export function systemPrefersDark(win: Pick<Window, 'matchMedia'> | undefined = globalThis.window): boolean {
  try {
    return !!win?.matchMedia?.('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** The CSS custom properties one accent sets in one mode. */
export function accentVars(accent: AccentId, mode: Mode): Record<string, string> {
  const a = ACCENTS[accent] ?? ACCENTS.brick;
  return {
    '--accent': a.main,
    '--accent-ink': a.onMain,
    '--accent-soft': a.soft[mode],
    '--accent-text': a.text[mode],
  };
}

/** The CSS custom properties one mode sets (`--bg`, `--panel`, ... from the tokens). */
export function neutralVars(mode: Mode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(NEUTRALS[mode])) out[`--${kebab(k)}`] = v;
  return out;
}

export function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Root font size as a percentage of the browser default. */
export function rootFontSize(largeText: boolean): string {
  return largeText ? `${LARGE_TEXT_SCALE * 100}%` : '';
}

/**
 * Put the preferences on <html>: `data-theme` (the resolved mode),
 * `data-accent`, `data-text`, the root font size and `color-scheme`.
 * The colours themselves live in styles.css keyed on these attributes.
 */
export function applyTheme(root: HTMLElement, prefs: Pick<Preferences, 'theme' | 'accent' | 'largeText'>, systemDark: boolean): Mode {
  const mode = resolveMode(prefs.theme, systemDark);
  root.dataset.theme = mode;
  root.dataset.themeChoice = prefs.theme;
  root.dataset.accent = (ACCENT_IDS as readonly string[]).includes(prefs.accent) ? prefs.accent : 'brick';
  root.dataset.text = prefs.largeText ? 'large' : 'normal';
  root.style.fontSize = rootFontSize(prefs.largeText);
  root.style.colorScheme = mode;
  return mode;
}

/** Keep only well-formed keys; anything else falls back to the default. */
export function sanitizePreferences(input: unknown): Preferences {
  const out: Preferences = { ...DEFAULT_PREFERENCES, toursSeen: [] };
  if (typeof input !== 'object' || input === null) return out;
  const o = input as Record<string, unknown>;
  if ((THEME_CHOICES as readonly unknown[]).includes(o.theme)) out.theme = o.theme as ThemeChoice;
  if ((ACCENT_IDS as readonly unknown[]).includes(o.accent)) out.accent = o.accent as AccentId;
  for (const k of ['largeText', 'expertMode', 'helpIcons'] as const) {
    if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  }
  if (Array.isArray(o.toursSeen)) out.toursSeen = o.toursSeen.filter((t): t is string => typeof t === 'string');
  if (typeof o.partsIconSize === 'number' && Number.isFinite(o.partsIconSize)) {
    out.partsIconSize = Math.round(Math.min(PARTS_ICON_MAX, Math.max(PARTS_ICON_MIN, o.partsIconSize)));
  }
  return out;
}

export function readCachedPreferences(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Preferences {
  try {
    const raw = storage?.getItem(PREFS_CACHE_KEY);
    return sanitizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES, toursSeen: [] };
  }
}

export function writeCachedPreferences(prefs: Preferences, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked storage: the account copy still holds.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
