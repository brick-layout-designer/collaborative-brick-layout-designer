// Tests for the pure logic extracted from dockLayout.ts.
// The hook itself requires a React environment and localStorage; we test the
// state-transition functions in isolation by importing the named exports.
// Since dockLayout.ts only exports the hook (not the helper fns), we import
// the module and verify observable behaviour via renderHook + jsdom.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDockLayout } from '../dockLayout';

// jsdom ships a real localStorage implementation, so no stub needed.

function freshHook(userId: string | null = null) {
  // Each test should start from the default layout so clear any prior state.
  localStorage.clear();
  return renderHook(() => useDockLayout(userId));
}

describe('useDockLayout — default state', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('starts with parts and layers on the right', () => {
    const { result } = freshHook();
    expect(result.current.state.right).toContain('parts');
    expect(result.current.state.right).toContain('layers');
  });

  it('starts with usedparts hidden', () => {
    const { result } = freshHook();
    expect(result.current.state.hidden).toContain('usedparts');
  });

  it('reports correct zone for a default panel', () => {
    const { result } = freshHook();
    expect(result.current.zoneOf('parts')).toBe('right');
    expect(result.current.zoneOf('layers')).toBe('right');
    expect(result.current.zoneOf('usedparts')).toBe('hidden');
    expect(result.current.zoneOf('unknown-panel')).toBe('hidden');
  });
});

describe('useDockLayout — setZone', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('moves a panel from right to left', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('parts', 'left'));
    expect(result.current.zoneOf('parts')).toBe('left');
    expect(result.current.state.right).not.toContain('parts');
  });

  it('moves a panel to float and assigns a default position', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('usedparts', 'float'));
    expect(result.current.zoneOf('usedparts')).toBe('float');
    const pos = result.current.state.floatPos['usedparts'];
    expect(pos).toBeDefined();
    expect(pos!.width).toBeGreaterThan(0);
    expect(pos!.height).toBeGreaterThan(0);
  });

  it('hides a previously visible panel', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('parts', 'hidden'));
    expect(result.current.zoneOf('parts')).toBe('hidden');
    expect(result.current.state.left).not.toContain('parts');
    expect(result.current.state.right).not.toContain('parts');
    expect(result.current.state.float).not.toContain('parts');
  });

  it('a panel appears in exactly one zone after setZone', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('layers', 'left'));
    const { left, right, hidden, float } = result.current.state;
    const allZones = [...left, ...right, ...hidden, ...float];
    const count = allZones.filter((id) => id === 'layers').length;
    expect(count).toBe(1);
  });
});

describe('useDockLayout — setDockWidth', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('clamps to minimum width', () => {
    const { result } = freshHook();
    act(() => result.current.setDockWidth('left', 10));
    expect(result.current.state.leftWidth).toBe(180);
  });

  it('clamps to maximum width', () => {
    const { result } = freshHook();
    act(() => result.current.setDockWidth('right', 9999));
    expect(result.current.state.rightWidth).toBe(600);
  });

  it('sets a valid width exactly', () => {
    const { result } = freshHook();
    act(() => result.current.setDockWidth('left', 350));
    expect(result.current.state.leftWidth).toBe(350);
  });
});

describe('useDockLayout — setPanelHeight', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('records a panel height', () => {
    const { result } = freshHook();
    act(() => result.current.setPanelHeight('layers', 300));
    expect(result.current.state.panelHeights['layers']).toBe(300);
  });

  it('clamps to minimum panel height', () => {
    const { result } = freshHook();
    act(() => result.current.setPanelHeight('layers', 10));
    expect(result.current.state.panelHeights['layers']).toBe(80);
  });
});

describe('useDockLayout — reorderPanel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('swaps two panels in the right dock', () => {
    const { result } = freshHook();
    // Default right = ['parts', 'layers']
    act(() => result.current.reorderPanel('right', 'layers', 'parts'));
    expect(result.current.state.right[0]).toBe('layers');
    expect(result.current.state.right[1]).toBe('parts');
  });

  it('is a no-op when fromId === toId', () => {
    const { result } = freshHook();
    const before = [...result.current.state.right];
    act(() => result.current.reorderPanel('right', 'parts', 'parts'));
    expect(result.current.state.right).toEqual(before);
  });

  it('is a no-op when fromId is not in the zone', () => {
    const { result } = freshHook();
    const before = [...result.current.state.right];
    act(() => result.current.reorderPanel('right', 'nonexistent', 'parts'));
    expect(result.current.state.right).toEqual(before);
  });
});

describe('useDockLayout — setFloatPos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('records a floating panel position', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('usedparts', 'float'));
    act(() => result.current.setFloatPos('usedparts', { x: 200, y: 150 }));
    expect(result.current.state.floatPos['usedparts']?.x).toBe(200);
    expect(result.current.state.floatPos['usedparts']?.y).toBe(150);
  });

  it('merges partial position updates', () => {
    const { result } = freshHook();
    act(() => result.current.setZone('usedparts', 'float'));
    act(() => result.current.setFloatPos('usedparts', { x: 100, y: 100, width: 300, height: 400 }));
    act(() => result.current.setFloatPos('usedparts', { width: 500 }));
    expect(result.current.state.floatPos['usedparts']?.width).toBe(500);
    expect(result.current.state.floatPos['usedparts']?.height).toBe(400);
  });
});

describe('useDockLayout — persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('persists state to localStorage and reloads it', () => {
    const { result: first, unmount } = renderHook(() => useDockLayout('user-abc'));
    act(() => first.current.setDockWidth('left', 400));
    unmount();

    const { result: second } = renderHook(() => useDockLayout('user-abc'));
    expect(second.current.state.leftWidth).toBe(400);
  });

  it('uses separate keys for different user IDs', () => {
    const { result: u1, unmount: u1unmount } = renderHook(() => useDockLayout('user-1'));
    act(() => u1.current.setDockWidth('left', 350));
    u1unmount();

    const { result: u2 } = renderHook(() => useDockLayout('user-2'));
    // user-2 should start from defaults, not user-1's state.
    expect(u2.current.state.leftWidth).toBe(280);
  });
});
