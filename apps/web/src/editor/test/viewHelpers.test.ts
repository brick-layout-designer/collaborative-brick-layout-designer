// View helpers: view centre in studs (label / text placement), the
// drop-target hint and header-dropdown placement.

import { afterEach, describe, expect, it } from 'vitest';
import { dropdownAnchor, dropTargetHint, viewCentreStuds, wheelZoomStep } from '../viewHelpers';
import { useEditorStore } from '../editorStore';

describe('viewCentreStuds', () => {
  afterEach(() => useEditorStore.setState({ panX: 0, panY: 0, zoom: 1 }));

  it('is the stage centre / 8 at pan 0, zoom 1', () => {
    expect(viewCentreStuds({ width: 800, height: 400 }, { panX: 0, panY: 0, zoom: 1 })).toEqual({ x: 50, y: 25 });
  });

  it('undoes pan and zoom', () => {
    // Centre px (400,200); world px = (400-80)/2 = 160 → 20 studs, (200+40)/2 = 120 → 15.
    expect(viewCentreStuds({ width: 800, height: 400 }, { panX: 80, panY: -40, zoom: 2 })).toEqual({ x: 20, y: 15 });
  });

  it('reads the live store by default', () => {
    useEditorStore.setState({ panX: -800, panY: 0, zoom: 0.5 });
    expect(viewCentreStuds({ width: 800, height: 400 })).toEqual({ x: 300, y: 50 });
  });
});

describe('dropTargetHint', () => {
  const layers = [
    { id: 'g', type: 'grid' as const, name: 'Grid' },
    { id: 'b1', type: 'brick' as const, name: 'Tracks' },
    { id: 'b2', type: 'brick' as const, name: '' },
  ];

  it('names the active brick layer', () => {
    expect(dropTargetHint(layers, 'b1')).toBe('Drop onto: Tracks (active layer)');
    expect(dropTargetHint(layers, 'b2')).toBe('Drop onto: unnamed (active layer)');
  });

  it('falls back to the first brick layer when the active one is not a brick layer', () => {
    expect(dropTargetHint(layers, 'g')).toBe('Drop onto: Tracks (active layer is not a brick layer)');
    expect(dropTargetHint(layers, null)).toBe('Drop onto: Tracks (active layer is not a brick layer)');
  });

  it('says when there is no brick layer', () => {
    expect(dropTargetHint([layers[0]!], 'g')).toBe('No brick layer — dropping creates one');
  });
});

describe('dropdownAnchor', () => {
  const button = (left: number, right: number, bottom: number) => ({
    getBoundingClientRect: () => ({ left, right, bottom, top: bottom - 24, width: right - left, height: 24, x: left, y: bottom - 24, toJSON: () => ({}) }),
  });

  it('right-aligns under the button', () => {
    expect(dropdownAnchor(button(900, 950, 40), 1024)).toEqual({ top: 44, right: 74 });
  });

  it('keeps a 4 px margin when the button is scrolled past the right edge', () => {
    expect(dropdownAnchor(button(1100, 1150, 40), 1024)).toEqual({ top: 44, right: 4 });
  });
});

describe('dropTargetHint store field', () => {
  it('is set and cleared, and an identical hint keeps the state object', () => {
    const st = useEditorStore.getState();
    st.setDropTargetHint('Drop onto: A (active layer)');
    const before = useEditorStore.getState();
    st.setDropTargetHint('Drop onto: A (active layer)');
    expect(useEditorStore.getState()).toBe(before);
    expect(useEditorStore.getState().dropTargetHint).toBe('Drop onto: A (active layer)');
    st.setDropTargetHint(null);
    expect(useEditorStore.getState().dropTargetHint).toBeNull();
  });
});

describe('wheelZoomStep (MapView.cpp:354-390)', () => {
  it('is 1.0015^-deltaY at factor 1', () => {
    expect(wheelZoomStep(-120)).toBeCloseTo(Math.pow(1.0015, 120), 10);
    expect(wheelZoomStep(120)).toBeCloseTo(Math.pow(1.0015, -120), 10);
  });

  it('caps the delta at ±480 (~2× per event)', () => {
    expect(wheelZoomStep(-5000)).toBeCloseTo(Math.pow(1.0015, 480), 10);
    expect(wheelZoomStep(5000)).toBeCloseTo(Math.pow(1.0015, -480), 10);
  });

  it('scales the exponent, not the base, by the wheel-zoom factor (regression)', () => {
    // The old pow(1.0015 * factor, -delta) gave 1.5^120 ≈ 1.4e21 for one
    // notch at factor 1.5 — straight to the zoom limit.
    const step = wheelZoomStep(-120, 1.5);
    expect(step).toBeCloseTo(Math.pow(1.0015, 180), 10);
    expect(step).toBeLessThan(1.4);
    expect(wheelZoomStep(-120, 0.5)).toBeCloseTo(Math.pow(1.0015, 60), 10);
    expect(wheelZoomStep(120, 2)).toBeGreaterThan(0.6);
  });
});
