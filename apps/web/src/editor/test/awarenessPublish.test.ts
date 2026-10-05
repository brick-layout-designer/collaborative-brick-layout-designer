// Regression: cursor movement must not re-render the editor tree. The
// cursor used to live in React state inside the Editor component, so each
// (rAF-coalesced) mouse move re-rendered everything at 60 Hz.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Awareness } from 'y-protocols/awareness';
import {
  CURSOR_PUBLISH_INTERVAL_MS,
  dispatchCursorLeave,
  dispatchCursorMove,
  usePublishAwareness,
} from '../useAwareness';
import type { AwarenessState } from '../awareness';
import type { Me } from '../../api';

const me = { id: 'u1', displayName: 'Alice', avatarUrl: null } as unknown as Me;

function fakeAwareness() {
  const states: AwarenessState[] = [];
  const awareness = {
    clientID: 1,
    setLocalState: vi.fn((s: AwarenessState) => states.push(s)),
  } as unknown as Awareness;
  return { awareness, states };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePublishAwareness', () => {
  it('publishes cursor moves throttled, without re-rendering', () => {
    const { awareness, states } = fakeAwareness();
    let renders = 0;
    renderHook(() => {
      renders++;
      usePublishAwareness({ awareness, me, layoutId: 'L' });
    });
    const rendersAfterMount = renders;
    const publishedAfterMount = states.length;
    expect(publishedAfterMount).toBeGreaterThan(0);

    // 100 mouse moves over ~100 ms.
    for (let i = 0; i < 100; i++) {
      act(() => dispatchCursorMove(i, i));
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(CURSOR_PUBLISH_INTERVAL_MS);

    expect(renders).toBe(rendersAfterMount);
    const cursorPublishes = states.length - publishedAfterMount;
    expect(cursorPublishes).toBeGreaterThanOrEqual(2);
    expect(cursorPublishes).toBeLessThanOrEqual(4);
    // Trailing edge carries the final position.
    expect(states.at(-1)!.cursor).toMatchObject({ x: 99, y: 99 });

    act(() => dispatchCursorLeave());
    vi.advanceTimersByTime(CURSOR_PUBLISH_INTERVAL_MS);
    expect(states.at(-1)!.cursor).toBeNull();
    expect(renders).toBe(rendersAfterMount);
  });
});

describe('Edit module in presence', () => {
  it('tells the others which module this person is editing', async () => {
    const { useEditorStore } = await import('../editorStore');
    const { awareness, states } = fakeAwareness();
    renderHook(() => usePublishAwareness({ awareness, me, layoutId: 'L' }));
    expect(states.at(-1)!.editingModule ?? null).toBeNull();
    act(() => useEditorStore.getState().setEditingModule('m1'));
    expect(states.at(-1)!.editingModule).toBe('m1');
    act(() => useEditorStore.getState().setEditingModule(null));
    expect(states.at(-1)!.editingModule).toBeNull();
  });
});
