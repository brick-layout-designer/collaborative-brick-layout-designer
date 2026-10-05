// @vitest-environment jsdom
// The picture size in the editor's Parts and Module library lists: a
// slider from 32 to 160 px, Ctrl/⌘ + wheel and pinch over the list, kept
// in the account's preferences (partsIconSize), and an older S/M/L
// choice from this browser moved there once.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { PartsPanel } from '../PartsPanel';
import { ModuleThumb } from '../../modules/ModuleThumb';
import { PrefsContext } from '../../theme/PrefsProvider';
import { DEFAULT_PREFERENCES, sanitizePreferences, type Preferences } from '../../theme/theme';
import { clampIconSize, legacyIconSize, LEGACY_ICON_KEY, tileMinWidth } from '../listIconSize';
import type { PartWire } from '../../api';

const part = (key: string, spriteSize?: { w: number; h: number }): PartWire => ({
  key,
  partNumber: key,
  colorCode: '',
  kind: 'leaf',
  description: `Part ${key}`,
  sortingKey: key,
  spritePath: `${key}.gif`,
  pxPerStud: 8,
  category: 'Plates',
  connections: [],
  subparts: [],
  hullPts: [],
  source: 'bundled',
  customPartId: null,
  ...(spriteSize ? { spriteSize } : {}),
});

let saved: Partial<Preferences>[];

beforeEach(() => {
  localStorage.clear();
  saved = [];
  vi.stubGlobal('fetch', async (input: string) => {
    if (input === '/api/parts/catalog') {
      return new Response(JSON.stringify({ parts: [part('3024', { w: 8, h: 8 }), part('big', { w: 512, h: 512 })] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A preferences provider that keeps what's set, and notes each change. */
function Prefs({ initial, ready = true, children }: { initial: Partial<Preferences>; ready?: boolean; children: ReactNode }) {
  const [prefs, setState] = useState<Preferences>({ ...DEFAULT_PREFERENCES, ...initial });
  const setPrefs = useCallback((c: Partial<Preferences>) => {
    saved.push(c);
    setState((p) => ({ ...p, ...c }));
  }, []);
  return (
    <PrefsContext.Provider value={{ prefs, mode: 'light', setPrefs, syncedToAccount: true, updatedAt: null, ready }}>
      {children}
    </PrefsContext.Provider>
  );
}

function renderPanel(initial: Partial<Preferences> = {}, ready = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Prefs initial={initial} ready={ready}>
        <PartsPanel onPlacePart={() => undefined} />
      </Prefs>
    </QueryClientProvider>,
  );
}

const slider = () => screen.getByRole('slider', { name: 'Part picture size' }) as HTMLInputElement;
const picture = (key: string) => screen.getByTitle(new RegExp(`\\(${key}\\)`)).querySelector('img') as HTMLImageElement;

describe('list picture size rules', () => {
  it('clamps to 32–160 whole pixels', () => {
    expect(clampIconSize(10)).toBe(32);
    expect(clampIconSize(500)).toBe(160);
    expect(clampIconSize(47.6)).toBe(48);
    expect(clampIconSize(Number.NaN)).toBe(48);
  });

  it('reads the old S/M/L as 32/48/64 and nothing else', () => {
    expect([legacyIconSize('S'), legacyIconSize('M'), legacyIconSize('L')]).toEqual([32, 48, 64]);
    expect(legacyIconSize('XL')).toBeNull();
    expect(legacyIconSize(null)).toBeNull();
  });

  it('cells grow with the picture, never narrower than it', () => {
    expect(tileMinWidth(32)).toBeGreaterThanOrEqual(56);
    expect(tileMinWidth(160)).toBeGreaterThan(160);
    expect(tileMinWidth(96)).toBeGreaterThan(tileMinWidth(64));
  });

  it('the account copy keeps only a sane size', () => {
    expect(sanitizePreferences({ partsIconSize: 96 }).partsIconSize).toBe(96);
    expect(sanitizePreferences({ partsIconSize: 999 }).partsIconSize).toBe(160);
    expect(sanitizePreferences({ partsIconSize: '96' }).partsIconSize).toBeUndefined();
    expect('partsIconSize' in sanitizePreferences({})).toBe(false);
  });
});

describe('Parts list picture size', () => {
  it('a visible slider from 32 to 160 sizes the pictures and is saved to the account', async () => {
    renderPanel({ partsIconSize: 64 });
    await screen.findByText('Part 3024');
    expect(slider().min).toBe('32');
    expect(slider().max).toBe('160');
    expect(slider().value).toBe('64');
    expect(picture('big').style.width).toBe('64px');
    fireEvent.change(slider(), { target: { value: '140' } });
    expect(picture('big').style.width).toBe('140px');
    expect(picture('big').style.height).toBe('140px');
    expect(saved).toEqual([{ partsIconSize: 140 }]);
  });

  it('Ctrl/⌘ + wheel over the list resizes; a plain wheel scrolls', async () => {
    renderPanel({ partsIconSize: 64 });
    await screen.findByText('Part 3024');
    const list = screen.getByRole('list').parentElement!;
    fireEvent.wheel(list, { deltaY: -40 });
    expect(slider().value).toBe('64');
    const zoomIn = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => void list.dispatchEvent(zoomIn));
    expect(zoomIn.defaultPrevented).toBe(true);
    expect(Number(slider().value)).toBeGreaterThan(64);
    act(() => void list.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, metaKey: true, bubbles: true, cancelable: true })));
    expect(Number(slider().value)).toBeLessThan(64);
  });

  it('a two-finger pinch over the list resizes', async () => {
    renderPanel({ partsIconSize: 48 });
    await screen.findByText('Part 3024');
    const list = screen.getByRole('list').parentElement!;
    const touch = (type: string, id: number, x: number) =>
      act(() => void list.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: 0, bubbles: true }), { pointerId: id, pointerType: 'touch' })));
    touch('pointerdown', 1, 100);
    touch('pointerdown', 2, 200);
    touch('pointermove', 2, 300); // fingers twice as far apart
    expect(slider().value).toBe('96');
    touch('pointerup', 1, 100);
    touch('pointerup', 2, 300);
  });

  it('a small sprite shown big scales in crisp pixels; a big one stays smooth', async () => {
    renderPanel({ partsIconSize: 120 });
    await screen.findByText('Part 3024');
    expect(picture('3024').style.imageRendering).toBe('pixelated');
    expect(picture('big').style.imageRendering).toBe('');
    // The full sprite, never a smaller copy.
    expect(picture('big').getAttribute('src')).toBe('/parts/big.gif');
  });

  it('moves an old S/M/L choice to the account once, then forgets it', async () => {
    localStorage.setItem(LEGACY_ICON_KEY, 'L');
    renderPanel({});
    await screen.findByText('Part 3024');
    expect(saved).toEqual([{ partsIconSize: 64 }]);
    expect(slider().value).toBe('64');
    expect(localStorage.getItem(LEGACY_ICON_KEY)).toBeNull();
  });

  it('an account that already has a size keeps it; the old local value is just removed', async () => {
    localStorage.setItem(LEGACY_ICON_KEY, 'S');
    renderPanel({ partsIconSize: 100 });
    await screen.findByText('Part 3024');
    expect(saved).toEqual([]);
    expect(slider().value).toBe('100');
    expect(localStorage.getItem(LEGACY_ICON_KEY)).toBeNull();
  });

  it('waits for the account settings to load before moving the old value', async () => {
    localStorage.setItem(LEGACY_ICON_KEY, 'L');
    renderPanel({}, false);
    await screen.findByText('Part 3024');
    expect(saved).toEqual([]);
    expect(localStorage.getItem(LEGACY_ICON_KEY)).toBe('L');
  });

  it('starts at 48 px with nothing saved anywhere', async () => {
    renderPanel({});
    await screen.findByText('Part 3024');
    expect(slider().value).toBe('48');
    expect(saved).toEqual([]);
  });
});

describe('Module library picture', () => {
  const mod = { id: 'm1', title: 'Station', thumbnailAt: 5 };
  it('uses the small copy up to 128 px and the full picture above', () => {
    const { rerender } = render(<ModuleThumb module={mod} px={96} />);
    const img = () => screen.getByTestId('module-thumb') as HTMLImageElement;
    expect(img().getAttribute('src')).toContain('size=small');
    expect(img().style.width).toBe('96px');
    rerender(<ModuleThumb module={mod} px={160} />);
    expect(img().getAttribute('src')).not.toContain('size=small');
  });
});
