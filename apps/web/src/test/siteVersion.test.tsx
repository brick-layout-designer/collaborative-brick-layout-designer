// "A new version of the site is ready · Reload", and the web's side of
// compat/compat.json (shared with the desktop app).

import compatJson from '../../../../compat/compat.json';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_FILE_VERSION } from '../layoutFile';
import { SiteVersionBar, VERSION_POLL_MS, isNewSiteVersion } from '../SiteVersionBar';

const compat = compatJson as {
  layoutFile: { version: number };
};

describe('compat/compat.json', () => {
  it('holds the .bld-layout version the web writes', () => {
    expect(LAYOUT_FILE_VERSION).toBe(compat.layoutFile.version);
  });
});

describe('isNewSiteVersion', () => {
  it('is true only when a known version changed', () => {
    expect(isNewSiteVersion('nightly-aaa', 'nightly-bbb')).toBe(true);
    expect(isNewSiteVersion('nightly-aaa', 'nightly-aaa')).toBe(false);
    expect(isNewSiteVersion(null, 'nightly-bbb')).toBe(false);
    expect(isNewSiteVersion('unknown', '1.0.0')).toBe(false);
  });
});

describe('SiteVersionBar', () => {
  let version = 'nightly-aaa';
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version }), { status: 200 })));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    version = 'nightly-aaa';
  });

  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

  it('shows after a deploy, on the next check, and never reloads by itself', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<SiteVersionBar />);
    await flush();
    expect(screen.queryByTestId('site-version-bar')).toBeNull();
    version = 'nightly-bbb';
    await act(async () => { await vi.advanceTimersByTimeAsync(VERSION_POLL_MS); });
    expect(screen.getByRole('status').textContent).toBe('A new version of the site is ready.');
    expect(reload).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: 'Reload' }).click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it('checks again when the window comes back into focus', async () => {
    render(<SiteVersionBar />);
    await flush();
    version = 'nightly-ccc';
    act(() => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(screen.getByTestId('site-version-bar')).toBeTruthy();
    act(() => screen.getByRole('button', { name: 'Not now' }).click());
    expect(screen.queryByTestId('site-version-bar')).toBeNull();
  });

  it('stays quiet while the version is unchanged', async () => {
    render(<SiteVersionBar />);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * VERSION_POLL_MS); });
    expect(screen.queryByTestId('site-version-bar')).toBeNull();
  });
});
