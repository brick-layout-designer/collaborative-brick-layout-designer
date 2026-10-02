// Touch editing: the press rules (tap, long press, move), the recent
// parts list, where a duplicate lands, the per-layout View / Edit choice,
// and useTouchView's taps, long presses and pan-or-drag choice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
  besideTarget,
  isTouchEvent,
  LONG_PRESS_MS,
  movedBeyondSlop,
  pressOutcome,
  pushRecent,
  readPhoneEdit,
  tapGuard,
  TAP_SLOP_PX,
  writePhoneEdit,
  type Pt,
  type View,
} from '../touchGesture';
import { useTouchView } from '../useTouchView';
import { TouchActionBar } from '../TouchEdit';
import { useEditorStore } from '../editorStore';

describe('press rules', () => {
  it('a finger that stays within the slop is a tap, or a long press once held', () => {
    const a = { x: 100, y: 100 };
    expect(movedBeyondSlop(a, { x: 100 + TAP_SLOP_PX, y: 100 })).toBe(false);
    expect(movedBeyondSlop(a, { x: 100 + TAP_SLOP_PX + 1, y: 100 })).toBe(true);
    expect(pressOutcome(a, { x: 104, y: 103 }, 120)).toBe('tap');
    expect(pressOutcome(a, { x: 104, y: 103 }, LONG_PRESS_MS)).toBe('long');
    expect(pressOutcome(a, { x: 130, y: 100 }, 120)).toBe('move');
    expect(pressOutcome(a, { x: 130, y: 100 }, 2000)).toBe('move');
  });

  it('knows a touch from a mouse', () => {
    expect(isTouchEvent({ pointerType: 'touch' })).toBe(true);
    expect(isTouchEvent({ pointerType: 'mouse' })).toBe(false);
    expect(isTouchEvent(new MouseEvent('mousedown'))).toBe(false);
    expect(isTouchEvent(null)).toBe(false);
  });
});

describe('recent parts', () => {
  it('puts the newest first, without repeats, up to the limit', () => {
    expect(pushRecent([], 'a')).toEqual(['a']);
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});

describe('besideTarget', () => {
  it('centres the copy a gap to the right of the originals', () => {
    // Two parts spanning x 0..20, y 0..10: the copy's centre is 8 past the right edge plus half the width.
    const t = besideTarget([{ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }]);
    expect(t).toEqual({ x: 20 + 8 + 10, y: 5 });
    expect(besideTarget([])).toBeNull();
  });
});

describe('View / Edit choice', () => {
  it('is View unless Edit was picked for this layout', () => {
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(readPhoneEdit(s, 'L1')).toBe(false);
    writePhoneEdit(s, 'L1', true);
    expect(readPhoneEdit(s, 'L1')).toBe(true);
    expect(readPhoneEdit(s, 'L2')).toBe(false);
    writePhoneEdit(s, 'L1', false);
    expect(readPhoneEdit(s, 'L1')).toBe(false);
    // Blocked storage: View.
    expect(readPhoneEdit({ getItem: () => { throw new Error('blocked'); } }, 'L1')).toBe(false);
    expect(readPhoneEdit(null, 'L1')).toBe(false);
  });
});

// ---- the hook ----------------------------------------------------------

function touchEvent(type: string, el: Element, pts: Pt[], target: Element = el): TouchEvent {
  const list = pts.map((p, i) => ({ identifier: i, clientX: p.x, clientY: p.y, target })) as unknown as Touch[];
  const e = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(e, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : list });
  Object.defineProperty(e, 'changedTouches', { value: list });
  target.dispatchEvent(e);
  return e;
}

interface Harness {
  el: HTMLDivElement;
  view: () => View;
  taps: Pt[];
  longs: Pt[];
  pinches: number;
  boxes: string[];
}

function setup(panFrom?: (p: Pt) => boolean, boxFrom?: (p: Pt) => boolean): Harness {
  const h: Harness = { el: null as unknown as HTMLDivElement, view: () => v, taps: [], longs: [], pinches: 0, boxes: [] };
  let v: View = { zoom: 1, panX: 0, panY: 0 };
  function Probe() {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    useTouchView(el, () => v, (n) => { v = n; }, {
      oneFingerPan: true,
      range: { min: 0.1, max: 10 },
      ...(panFrom ? { panFrom } : {}),
      ...(boxFrom ? { boxFrom } : {}),
      onBox: (phase, a, b) => h.boxes.push(`${phase} ${a.x},${a.y} ${b.x},${b.y}`),
      onTap: (p) => h.taps.push(p),
      onLongPress: (p) => h.longs.push(p),
      onPinchStart: () => { h.pinches++; },
    });
    return (
      <div ref={(n) => { if (n) { h.el = n; setEl(n); } }}>
        <button data-no-gesture>bar</button>
      </div>
    );
  }
  render(<Probe />);
  return h;
}

describe('useTouchView for touch editing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    tapGuard.suppress = false;
  });
  afterEach(() => vi.useRealTimers());

  it('reports a tap, and a part keeps its own tap', () => {
    const h = setup();
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    touchEvent('touchend', h.el, [{ x: 12, y: 11 }]);
    expect(h.taps).toEqual([{ x: 10, y: 10 }]);
    expect(h.longs).toEqual([]);
    expect(tapGuard.suppress).toBe(false);
  });

  it('a press held still is a long press, not a tap, and stops the part tap', () => {
    const h = setup();
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(h.longs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.longs).toEqual([{ x: 10, y: 10 }]);
    expect(tapGuard.suppress).toBe(true);
    touchEvent('touchend', h.el, [{ x: 10, y: 10 }]);
    expect(h.taps).toEqual([]);
  });

  it('a finger that moves pans the view, and is neither tap nor long press', () => {
    const h = setup();
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    touchEvent('touchmove', h.el, [{ x: 40, y: 10 }]);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    touchEvent('touchend', h.el, [{ x: 40, y: 10 }]);
    expect(h.view().panX).toBe(30);
    expect(h.taps).toEqual([]);
    expect(h.longs).toEqual([]);
    expect(tapGuard.suppress).toBe(true);
  });

  it('a finger on a picked part drags the part, not the view', () => {
    const h = setup((p) => p.x > 50);
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    const move = touchEvent('touchmove', h.el, [{ x: 40, y: 10 }]);
    touchEvent('touchend', h.el, [{ x: 40, y: 10 }]);
    expect(h.view().panX).toBe(0);
    // The page isn't stopped from handing the move on (Konva drags the part).
    expect(move.defaultPrevented).toBe(false);
    // Elsewhere the view pans.
    touchEvent('touchstart', h.el, [{ x: 60, y: 10 }]);
    touchEvent('touchmove', h.el, [{ x: 70, y: 10 }]);
    expect(h.view().panX).toBe(10);
  });

  it('two fingers pinch, stop a drag, and are never a tap', () => {
    const h = setup();
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }, { x: 50, y: 10 }]);
    expect(h.pinches).toBe(1);
    touchEvent('touchmove', h.el, [{ x: 0, y: 10 }, { x: 80, y: 10 }]);
    expect(h.view().zoom).toBeCloseTo(2, 6);
    touchEvent('touchend', h.el, []);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(h.taps).toEqual([]);
    expect(h.longs).toEqual([]);
  });

  it('"Select area": one finger draws a box, and the view stays put', () => {
    const h = setup(undefined, () => true);
    const start = touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    expect(start.defaultPrevented).toBe(true);
    touchEvent('touchmove', h.el, [{ x: 40, y: 20 }]);
    touchEvent('touchmove', h.el, [{ x: 60, y: 50 }]);
    touchEvent('touchend', h.el, []);
    expect(h.boxes).toEqual(['move 10,10 40,20', 'move 10,10 60,50', 'end 10,10 60,50']);
    expect(h.view()).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(h.taps).toEqual([]);
  });

  it('a second finger gives up the box and pinches instead', () => {
    const h = setup(undefined, () => true);
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    touchEvent('touchmove', h.el, [{ x: 30, y: 10 }]);
    touchEvent('touchstart', h.el, [{ x: 30, y: 10 }, { x: 70, y: 10 }]);
    expect(h.boxes).toEqual(['move 10,10 30,10', 'cancel 10,10 30,10']);
    touchEvent('touchmove', h.el, [{ x: 10, y: 10 }, { x: 90, y: 10 }]);
    expect(h.view().zoom).toBeCloseTo(2, 6);
    touchEvent('touchend', h.el, []);
    expect(h.boxes).toHaveLength(2);
  });

  it('a finger on a picked part still drags the part with "Select area" on', () => {
    // Not a box there, and not a pan either.
    const h = setup(() => false, (p) => p.x > 50);
    touchEvent('touchstart', h.el, [{ x: 10, y: 10 }]);
    touchEvent('touchmove', h.el, [{ x: 40, y: 10 }]);
    touchEvent('touchend', h.el, []);
    expect(h.boxes).toEqual([]);
    expect(h.view().panX).toBe(0);
  });

  it('leaves the buttons over the map alone', () => {
    const h = setup();
    const bar = h.el.querySelector('button')!;
    const start = touchEvent('touchstart', h.el, [{ x: 10, y: 10 }], bar);
    expect(start.defaultPrevented).toBe(false);
    touchEvent('touchend', h.el, [{ x: 10, y: 10 }], bar);
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    expect(h.taps).toEqual([]);
    expect(h.longs).toEqual([]);
  });
});

describe('the touch bar', () => {
  afterEach(() => {
    cleanup();
    useEditorStore.setState({ selection: [], touchSelectMore: false, touchSelectArea: false });
  });
  const actions = { rotate: () => {}, duplicate: () => {}, delete: () => {} };

  it('turns "Select area" on and off, with or without parts picked, and Done turns it off', () => {
    render(<TouchActionBar actions={actions} onAddPart={() => {}} />);
    const area = () => screen.getByRole('button', { name: 'Select area' });
    expect(area().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(area());
    expect(useEditorStore.getState().touchSelectArea).toBe(true);
    expect(area().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/Drag a box/);
    act(() => useEditorStore.setState({ selection: ['b1'] }));
    expect(area().getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(useEditorStore.getState().touchSelectArea).toBe(false);
    expect(useEditorStore.getState().selection).toEqual([]);
  });
});
