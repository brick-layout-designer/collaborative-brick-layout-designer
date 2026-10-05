// The picture size in the editor's Parts and Module library lists: a
// slider over the list, Ctrl/⌘ + wheel (and a trackpad pinch, which the
// browser sends as one) over it, and a two-finger pinch on touch. The
// size is an account preference (partsIconSize), so it follows the
// person between browsers and to the desktop app.

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { usePreferences } from '../theme/PrefsProvider';
import { PARTS_ICON_MAX, PARTS_ICON_MIN } from '../theme/theme';

export { PARTS_ICON_MAX as ICON_MAX, PARTS_ICON_MIN as ICON_MIN };
export const ICON_DEFAULT = 48;
export const ICON_STEP = 4;

/** Older builds kept S/M/L in this browser only. */
export const LEGACY_ICON_KEY = 'cld:partsIconSize';
const LEGACY_SIZES: Record<string, number> = { S: 32, M: 48, L: 64 };

export function clampIconSize(n: number): number {
  if (!Number.isFinite(n)) return ICON_DEFAULT;
  return Math.round(Math.min(PARTS_ICON_MAX, Math.max(PARTS_ICON_MIN, n)));
}

/** The old S/M/L value as pixels, or null when there's none. */
export function legacyIconSize(raw: string | null): number | null {
  return (raw && LEGACY_SIZES[raw]) || null;
}

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_ICON_KEY);
  } catch {
    return null;
  }
}

function dropLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_ICON_KEY);
  } catch {
    /* blocked storage: nothing to tidy */
  }
}

/** Grid cell width for a picture size, with space for the caption under it. */
export function tileMinWidth(size: number): number {
  return Math.max(56, Math.round(size * 1.15 + 24));
}

/**
 * The list picture size and its setter. The first time the account's
 * settings load without a size, an old S/M/L choice from this browser
 * becomes the account's size; the old value is then removed.
 */
export function useListIconSize(): [number, (n: number) => void] {
  const { prefs, setPrefs, ready } = usePreferences();
  const stored = prefs.partsIconSize;
  useEffect(() => {
    if (!ready) return;
    const raw = readLegacy();
    if (raw === null) return;
    const old = legacyIconSize(raw);
    if (stored === undefined && old !== null) setPrefs({ partsIconSize: old });
    dropLegacy();
  }, [ready, stored, setPrefs]);
  const setSize = useCallback(
    (n: number) => {
      const next = clampIconSize(n);
      if (next !== stored) setPrefs({ partsIconSize: next });
    },
    [setPrefs, stored],
  );
  return [stored ?? legacyIconSize(readLegacy()) ?? ICON_DEFAULT, setSize];
}

/** Ctrl/⌘ + wheel and two-finger pinch over `ref` change the size. */
export function useResizeGestures(ref: RefObject<HTMLElement | null>, size: number, setSize: (n: number) => void): void {
  // Handlers are attached once; they read the latest values from here.
  const latest = useRef({ size, setSize });
  useEffect(() => {
    latest.current = { size, setSize };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // Keep the page itself from zooming.
      e.preventDefault();
      const { size: cur, setSize: set } = latest.current;
      const step = Math.max(1, Math.min(16, Math.abs(e.deltaY) * 0.25));
      set(clampIconSize(cur + (e.deltaY < 0 ? step : -step)));
    };
    const touches = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; size: number } | null = null;
    const spread = () => {
      const [a, b] = [...touches.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) pinch = { dist: Math.max(1, spread()), size: latest.current.size };
    };
    const onMove = (e: PointerEvent) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size === 2) latest.current.setSize(clampIconSize(pinch.size * (spread() / pinch.dist)));
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [ref]);
}

/**
 * The visible size control: small picture · slider · big picture. Compact
 * enough to share a row with the list's filter, so the list keeps its room.
 */
export function IconSizeSlider({
  value,
  onChange,
  label = 'Picture size',
  className = '',
}: {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  className?: string;
}) {
  const icon = (px: number) => (
    <svg aria-hidden width={px} height={px} viewBox="0 0 16 16" className="shrink-0 text-muted">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="5.5" cy="5.5" r="1.5" fill="currentColor" />
      <path d="M2.5 13l4-4.5 3 3 2-2 2.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
  return (
    <label className={`flex items-center gap-1 ${className}`} title={`${label}: ${value} px (Ctrl/⌘ + scroll or pinch over the list also works)`}>
      <span className="sr-only">{label}</span>
      {icon(10)}
      <input
        type="range"
        min={PARTS_ICON_MIN}
        max={PARTS_ICON_MAX}
        step={ICON_STEP}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value} pixels`}
        className="h-5 min-w-0 flex-1 cursor-pointer accent-accent pointer-coarse:h-11"
      />
      {icon(16)}
    </label>
  );
}
