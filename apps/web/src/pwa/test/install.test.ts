// Installing the web app: the browser's offer is kept for Settings, an
// iPhone gets the Share › Add to Home Screen steps, and an installed app
// says so.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installState, isAppleMobile, listenForInstall, resetInstallForTests } from '../install';

import manifestText from '../../../public/manifest.webmanifest?raw';
import indexHtml from '../../../index.html?raw';

// Every file in public/, by its URL path.
const publicFiles = new Set(Object.keys(import.meta.glob('../../../public/*')).map((p) => p.replace('../../../public', '')));

function fakeWindow(opts: { ua?: string; standalone?: boolean; touch?: number } = {}) {
  const target = new EventTarget();
  return Object.assign(target, {
    navigator: { userAgent: opts.ua ?? 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140', maxTouchPoints: opts.touch ?? 0 },
    matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' && !!opts.standalone }),
  }) as unknown as Window;
}

function offer(outcome: 'accepted' | 'dismissed') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

afterEach(resetInstallForTests);

describe('install the app', () => {
  it("keeps the browser's offer for Settings and installs from it", async () => {
    const win = fakeWindow();
    listenForInstall(win);
    expect(installState(win).kind).toBe('browser-menu');
    const e = offer('accepted');
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true); // no mini-bar; Settings shows it
    const state = installState(win);
    expect(state.kind).toBe('prompt');
    if (state.kind !== 'prompt') return;
    expect(await state.install()).toBe(true);
    expect(e.prompt).toHaveBeenCalled();
    expect(installState(win).kind).toBe('installed');
  });

  it('offers again later when turned down', async () => {
    const win = fakeWindow();
    listenForInstall(win);
    win.dispatchEvent(offer('dismissed'));
    const state = installState(win);
    if (state.kind !== 'prompt') throw new Error(state.kind);
    expect(await state.install()).toBe(false);
    expect(installState(win).kind).toBe('browser-menu');
  });

  it('says installed when running as the app, and gives iPhone and iPad the Share steps', () => {
    expect(installState(fakeWindow({ standalone: true })).kind).toBe('installed');
    expect(installState(fakeWindow({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).kind).toBe('ios');
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 } as Navigator)).toBe(true);
    expect(isAppleMobile({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 } as Navigator)).toBe(false);
  });

  it('has a manifest browsers accept, with every icon it lists', () => {
    const m = JSON.parse(manifestText) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };
    expect(m.name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    // Chrome needs a 192 and a 512 icon; Android masks the maskable ones.
    expect(m.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
    expect(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(publicFiles.has(i.src), i.src).toBe(true);
    const html = indexHtml;
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
  });
});
