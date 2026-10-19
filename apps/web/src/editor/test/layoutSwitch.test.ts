// Switching layouts never mixes them: each layout id gets its own doc and
// provider, and a layout left with offline edits keeps its own connection
// until they're sent, to that layout only.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

type Handler = (arg: unknown) => void;
const providers: FakeProvider[] = [];

class FakeProvider {
  handlers = new Map<string, Handler[]>();
  awareness = {};
  wsconnected = true;
  synced = false;
  ws: { bufferedAmount: number } | null = { bufferedAmount: 0 };
  disconnected = false;
  destroyed = false;
  constructor(
    _url: string,
    readonly room: string,
    readonly doc: Y.Doc,
  ) {
    providers.push(this);
  }
  on(event: string, h: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), h]);
  }
  off(event: string, h: Handler) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((x) => x !== h));
  }
  emit(event: string, arg: unknown) {
    if (event === 'sync') this.synced = arg as boolean;
    for (const h of this.handlers.get(event) ?? []) h(arg);
  }
  disconnect() {
    this.disconnected = true;
  }
  destroy() {
    this.destroyed = true;
  }
}

vi.mock('y-websocket', () => ({ WebsocketProvider: FakeProvider }));

const { MERGE_REFUSED, layoutsStillSending, useLayoutDoc } = await import('../useLayoutDoc');

function addLayer(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    doc.getMap('layerData').set(id, new Y.Map());
    doc.getArray<string>('layers').push([id]);
  });
}

describe('switching layouts', () => {
  afterEach(() => {
    providers.length = 0;
    vi.useRealTimers();
  });

  it('gives each layout id its own doc and provider, and closes the one left', () => {
    const { result, rerender } = renderHook(({ id }) => useLayoutDoc(id), { initialProps: { id: 'A' } });
    const a = providers.at(-1)!;
    act(() => a.emit('sync', true));
    act(() => addLayer(a.doc, 'only-in-A'));
    expect(result.current.doc).toBe(a.doc);

    rerender({ id: 'B' });
    const b = providers.at(-1)!;
    expect(b).not.toBe(a);
    expect(b.room).toBe('B');
    expect(b.doc).not.toBe(a.doc);
    expect(b.doc.getArray('layers').toArray()).toEqual([]);
    // A was synced: nothing left to send, so its connection closes now.
    expect(a.destroyed).toBe(true);
    expect(layoutsStillSending()).toEqual([]);
  });

  it('a layout left with offline edits sends them to itself when back online, then closes', () => {
    vi.useFakeTimers();
    const { rerender, unmount } = renderHook(({ id }) => useLayoutDoc(id), { initialProps: { id: 'A' } });
    const a = providers.at(-1)!;
    act(() => a.emit('sync', true));
    // Offline: the edit stays in A's doc until the connection is back.
    a.wsconnected = false;
    act(() => a.emit('sync', false));
    act(() => addLayer(a.doc, 'offline-edit'));

    rerender({ id: 'B' });
    const b = providers.at(-1)!;
    expect(a.destroyed).toBe(false);
    expect(layoutsStillSending()).toEqual(['A']);
    expect(b.doc.getArray('layers').toArray()).toEqual([]);

    // Back online: A's provider resyncs A (its step 2 carries the edit).
    a.wsconnected = true;
    act(() => a.emit('sync', true));
    act(() => vi.advanceTimersByTime(200));
    expect(a.destroyed).toBe(true);
    expect(layoutsStillSending()).toEqual([]);
    expect(b.doc.getArray('layers').toArray()).toEqual([]);
    unmount();
  });

  it('a left layout whose connection ends for good stops waiting', () => {
    const { rerender, unmount } = renderHook(({ id }) => useLayoutDoc(id), { initialProps: { id: 'A' } });
    const a = providers.at(-1)!;
    act(() => a.emit('sync', true));
    a.wsconnected = false;
    act(() => a.emit('sync', false));
    act(() => addLayer(a.doc, 'offline-edit'));
    rerender({ id: 'B' });
    expect(layoutsStillSending()).toEqual(['A']);
    act(() => a.emit('connection-close', { code: 4404, reason: 'access_revoked' }));
    expect(a.destroyed).toBe(true);
    expect(layoutsStillSending()).toEqual([]);
    unmount();
  });

  it('says plainly when the server refuses a merge, and stops reconnecting', () => {
    const { result } = renderHook(() => useLayoutDoc('C'));
    const p = providers.at(-1)!;
    act(() => p.emit('connection-close', { code: 1008, reason: 'layout_merge_refused' }));
    expect(result.current.loadError?.message).toBe(MERGE_REFUSED);
    expect(p.disconnected).toBe(true);
  });
});
