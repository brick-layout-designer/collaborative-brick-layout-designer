import { afterEach, beforeEach } from 'vitest';
import { mountConfirmHost, unmountConfirmHost } from './confirmHost';

// Replace jsdom's localStorage with a proper in-memory implementation that
// supports all standard methods including clear(). jsdom's optional
// --localstorage-file flag can strip clear() away; this stub is stable.
const store: Record<string, string> = {};
const localStorageShim: Storage = {
  getItem: (k: string) => Object.prototype.hasOwnProperty.call(store, k) ? store[k]! : null,
  setItem: (k: string, v: string) => { store[k] = String(v); },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: localStorageShim, writable: true });
}

// The app's confirmation dialog (main.tsx mounts it in the app).
if (typeof document !== 'undefined') {
  beforeEach(() => mountConfirmHost());
  afterEach(() => unmountConfirmHost());
}
