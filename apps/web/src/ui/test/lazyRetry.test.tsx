// lazyRetry: a panel whose download fails while the Wi-Fi is down waits for
// the Wi-Fi (and says so) instead of blanking the page.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Suspense } from 'react';
import { lazyRetry, loadWithRetry, preloadLazy, WAITING_FOR_WIFI } from '../lazyRetry';
import { ToastHost } from '../ConfirmDialog';

function setOnline(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

afterEach(() => setOnline(true));

describe('loadWithRetry', () => {
  it('offline, waits for the Wi-Fi and then loads', async () => {
    setOnline(false);
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module')).mockResolvedValue('panel');
    const p = loadWithRetry(load);
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await expect(p).resolves.toBe('panel');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('online, gives up after a few tries', async () => {
    const load = vi.fn(() => Promise.reject(new Error('gone')));
    await expect(loadWithRetry(load, 3, 1)).rejects.toThrow('gone');
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('lazyRetry', () => {
  it('a panel opened offline says it waits for the Wi-Fi, then shows up', async () => {
    setOnline(false);
    let fail = true;
    const Panel = lazyRetry(() =>
      fail ? Promise.reject(new TypeError('Failed to fetch dynamically imported module')) : Promise.resolve({ default: () => <p>Modules panel</p> }),
    );
    render(
      <>
        <ToastHost />
        <Suspense fallback={null}>
          <Panel />
        </Suspense>
      </>,
    );
    expect(await screen.findByText(WAITING_FOR_WIFI)).toBeTruthy();
    fail = false;
    setOnline(true);
    act(() => void window.dispatchEvent(new Event('online')));
    expect(await screen.findByText('Modules panel')).toBeTruthy();
  });

  it('preloadLazy fetches each panel once, so it opens without the network later', async () => {
    const load = vi.fn(() => Promise.resolve({ default: () => <p>Find</p> }));
    const Find = lazyRetry(load);
    await preloadLazy();
    expect(load).toHaveBeenCalledTimes(1);
    render(
      <Suspense fallback={null}>
        <Find />
      </Suspense>,
    );
    expect(await screen.findByText('Find')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
