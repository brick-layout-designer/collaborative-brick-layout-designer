// Design tokens: the one list of colors, type and shapes the web app
// and the desktop app (src/ui/theme/Tokens.{h,cpp}) share. The CSS
// variables in styles.css carry the same values; theme.test.ts checks
// that the two agree.

export type Mode = 'light' | 'dark';

export const NEUTRAL_KEYS = [
  'bg',
  'panel',
  'line',
  'border',
  'ink',
  'muted',
  'soft',
  'grid',
  'gridLine',
  'roomLine',
  'ok',
  'okSoft',
  'danger',
  'tourBg',
  'tourInk',
  'tourMuted',
] as const;
export type NeutralKey = (typeof NEUTRAL_KEYS)[number];

export const NEUTRALS: Record<Mode, Record<NeutralKey, string>> = {
  light: {
    bg: '#F6F4EF',
    panel: '#FFFFFF',
    line: '#E4E0D8',
    border: '#D6D1C7',
    ink: '#1E2124',
    muted: '#5B6168',
    soft: '#F1EEE8',
    grid: '#EDEAE3',
    gridLine: '#E2DED5',
    roomLine: '#9A948A',
    ok: '#1F6B3A',
    okSoft: '#E8F3EC',
    danger: '#A8331F',
    tourBg: '#1E2124',
    tourInk: '#FFFFFF',
    tourMuted: '#C9CDD2',
  },
  dark: {
    bg: '#16181B',
    panel: '#1F2226',
    line: '#30343A',
    border: '#3A3F45',
    ink: '#ECEDEF',
    muted: '#A3A9B0',
    soft: '#2A2E33',
    grid: '#1A1C1F',
    gridLine: '#25282C',
    roomLine: '#6B7078',
    ok: '#7FD39B',
    okSoft: '#1D3326',
    danger: '#F2A08F',
    tourBg: '#F3F1EC',
    tourInk: '#1E2124',
    tourMuted: '#4A5057',
  },
};

export const ACCENT_IDS = ['brick', 'ocean', 'forest', 'plum', 'sunny', 'teal', 'orange', 'rose', 'indigo', 'slate'] as const;
export type AccentId = (typeof ACCENT_IDS)[number];

export interface Accent {
  /** Plain-words name shown in Settings. */
  label: string;
  /** Filled buttons, the selected tool, focus rings. */
  main: string;
  /** Text and icons drawn on `main`. */
  onMain: string;
  soft: Record<Mode, string>;
  /** Accent-colored text on panels (links, the active tab). */
  text: Record<Mode, string>;
}

/**
 * Contrast (WCAG 2.1), checked in theme.test.ts:
 * - `onMain` on `main` is at least 4.5:1 for every color. Sunny's
 *   #B8860B only reaches 3.25:1 with white, so sunny buttons use dark
 *   ink (4.97:1) instead of darkening the yellow into brown.
 * - `text` on panel, bg and soft is at least 4.5:1 in both modes.
 */
export const ACCENTS: Record<AccentId, Accent> = {
  brick: {
    label: 'Brick red',
    main: '#C2412D',
    onMain: '#FFFFFF',
    soft: { light: '#FBE9E5', dark: '#3A221E' },
    text: { light: '#A8331F', dark: '#F2A08F' },
  },
  ocean: {
    label: 'Ocean blue',
    main: '#2459C4',
    onMain: '#FFFFFF',
    soft: { light: '#E6EEFB', dark: '#1C2940' },
    text: { light: '#1D4AA6', dark: '#93B4F0' },
  },
  forest: {
    label: 'Forest green',
    main: '#2E7D4F',
    onMain: '#FFFFFF',
    soft: { light: '#E4F2E9', dark: '#1C3326' },
    text: { light: '#256942', dark: '#8FD1A8' },
  },
  plum: {
    label: 'Plum',
    main: '#8A4FBF',
    onMain: '#FFFFFF',
    soft: { light: '#F1E8F9', dark: '#2E2238' },
    text: { light: '#7340A3', dark: '#C9A6EA' },
  },
  sunny: {
    label: 'Sunny yellow',
    main: '#B8860B',
    onMain: '#1E2124',
    soft: { light: '#FBF1D9', dark: '#3A2F14' },
    text: { light: '#8A6508', dark: '#E9C86A' },
  },
  teal: {
    label: 'Lagoon teal',
    main: '#0F7C80',
    onMain: '#FFFFFF',
    soft: { light: '#E0F2F2', dark: '#16302F' },
    text: { light: '#0B6569', dark: '#7FD0CF' },
  },
  orange: {
    label: 'Pumpkin orange',
    main: '#B9520B',
    onMain: '#FFFFFF',
    soft: { light: '#FCEBDD', dark: '#3A2616' },
    text: { light: '#A0470A', dark: '#F4B183' },
  },
  rose: {
    label: 'Rose pink',
    main: '#C2335F',
    onMain: '#FFFFFF',
    soft: { light: '#FBE6EC', dark: '#3A1E27' },
    text: { light: '#A6284F', dark: '#F2A3BA' },
  },
  indigo: {
    label: 'Indigo',
    main: '#4B4FC4',
    onMain: '#FFFFFF',
    soft: { light: '#EAEAFB', dark: '#23243F' },
    text: { light: '#3E42A8', dark: '#B0B3F2' },
  },
  slate: {
    label: 'Slate gray',
    main: '#4F5B6B',
    onMain: '#FFFFFF',
    soft: { light: '#EBEEF2', dark: '#262B32' },
    text: { light: '#46505E', dark: '#B6C0CC' },
  },
};

export const FONTS = {
  heading: "'Bricolage Grotesque', 'Figtree', ui-sans-serif, system-ui, sans-serif",
  body: "'Figtree', ui-sans-serif, system-ui, sans-serif",
} as const;

/** Corner radii in px: controls, cards, bubbles, sections. */
export const RADIUS = { control: 10, card: 12, bubble: 14, section: 18 } as const;

/** Spacing grid in px. */
export const SPACING = 8;

/** Root font-size scale for "Bigger text and buttons". */
export const LARGE_TEXT_SCALE = 1.125;
