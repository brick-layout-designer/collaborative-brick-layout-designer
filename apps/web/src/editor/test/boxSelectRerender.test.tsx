// Regression: dragging a box to pick parts re-renders the map's canvas on
// every frame. The rulers and the grid came along each time with new point
// arrays, and Konva then redrew their whole layers: the parts sheet (every
// part, and its hit canvas) and the grid, on every mouse move. 1,300 part
// draws a frame on Fordyce, 6,700 on a 5,000-part layout. A re-render that
// changes nothing they draw now renders no ruler and no grid line.

import { describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDefaultLayoutDoc } from '@cld/ydoc';

let prims = 0;
vi.mock('react-konva', () => {
  const mk = () => (p: { children?: ReactNode }) => {
    prims++;
    return h(Fragment, null, p.children);
  };
  return { Group: mk(), Circle: mk(), Line: mk(), Text: mk(), Rect: mk(), Shape: mk() };
});

import { addCircularRuler, addLinearRuler, ensureRulerLayer } from '../mutations';
import { RulerLayers } from '../render/RulerLayer';
import { GridLayer } from '../render/GridLayer';
import { projectDoc } from '../useDocMap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('RulerLayers re-render scope', () => {
  it('renders no ruler again when only the handlers are new, and one when one ruler changes', async () => {
    const doc = createDefaultLayoutDoc();
    const layer = ensureRulerLayer(doc);
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(addLinearRuler(doc, layer, { x: 0, y: i * 10 }, { x: 40, y: i * 10 }));
    for (let i = 0; i < 5; i++) addCircularRuler(doc, layer, { x: 100, y: i * 30 }, 8);
    const root = createRoot(document.createElement('div'));
    const calls: string[] = [];
    // As the editor does: new functions on every render.
    const render = (selected: ReadonlySet<string>) =>
      h(RulerLayers, {
        map: projectDoc(doc)!,
        selectedRulerIds: selected,
        onRulerSelect: (id: string) => calls.push(`select ${id}`),
        onRulerDoubleClick: (id: string) => calls.push(`edit ${id}`),
        onEndpointDrag: () => undefined,
        onScaleDrag: () => undefined,
        drag: { start: () => undefined, move: () => undefined, end: () => undefined },
      });

    const none = new Set<string>();
    await act(async () => root.render(render(none)));
    const first = prims;
    expect(first).toBeGreaterThan(25 * 2);

    // The canvas re-renders (a box-select frame): no ruler renders again.
    prims = 0;
    await act(async () => root.render(render(none)));
    expect(prims).toBeLessThanOrEqual(2);

    // Picking one ruler renders that one only.
    prims = 0;
    await act(async () => root.render(render(new Set([ids[3]!]))));
    expect(prims).toBeGreaterThan(0);
    expect(prims).toBeLessThan(first / 10);
  });
});

describe('GridLayer re-render scope', () => {
  it('renders nothing again when the view moves: the grid draws for the view when Konva draws it', async () => {
    const doc = createDefaultLayoutDoc();
    const withLabels = projectDoc(doc)!;
    // Without the cell-index labels, the few Text nodes that do follow the view.
    const map = { ...withLabels, layers: withLabels.layers.map((l) => (l.type === 'grid' ? { ...l, displayCellIndex: false } : l)) };
    const root = createRoot(document.createElement('div'));
    // As the editor does: a new viewport object on every render.
    const render = (x: number, showGrid = true) =>
      h(GridLayer, { map, showGrid, cornerOverride: null, viewport: { studXMin: x, studYMin: 0, studXMax: x + 400, studYMax: 300 } });
    await act(async () => root.render(render(0)));
    expect(prims).toBeGreaterThan(0);

    prims = 0;
    await act(async () => root.render(render(0)));
    expect(prims).toBe(0);

    // Panned: nothing to render (it used to be every grid line).
    prims = 0;
    await act(async () => root.render(render(50)));
    expect(prims).toBe(0);

    // The grid turned off: it renders again.
    prims = 0;
    await act(async () => root.render(render(50, false)));
    expect(prims).toBeGreaterThan(0);
  });
});
