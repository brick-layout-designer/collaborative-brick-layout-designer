// Regression: the brick layer must only re-render what changed. With
// thousands of bricks, every canvas re-render (pan, marquee, HUD), every
// selection change and every one-brick edit used to re-render every
// glyph (2000+ Konva primitives for 1000 bricks).

import { describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BbmMap } from '@cld/model';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';

let prims = 0;
vi.mock('react-konva', () => {
  const mk = () => (p: { children?: ReactNode }) => {
    prims++;
    return h(Fragment, null, p.children);
  };
  return { Group: mk(), Image: mk(), Rect: mk(), Circle: mk(), Line: mk(), Text: mk() };
});

import { moveBrick, placeBrick } from '../mutations';
import { BrickLayer } from '../render/BrickLayer';
import { useEditorStore } from '../editorStore';
import { projectDoc } from '../useDocMap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('BrickLayer re-render scope', () => {
  it('re-renders only the glyphs whose brick or selection state changed', async () => {
    const N = 1000;
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    const ids: string[] = [];
    doc.transact(() => {
      for (let i = 0; i < N; i++) {
        ids.push(placeBrick(doc, layerId, { partNumber: 'track.0', x: i * 16, y: 0, width: 16, height: 8 }));
      }
    });
    const qc = new QueryClient();
    qc.setQueryData(['parts-catalog'], { parts: [] });
    const onEditBrick = () => undefined;
    const root = createRoot(document.createElement('div'));
    const render = (m: BbmMap) =>
      h(QueryClientProvider, { client: qc }, h(BrickLayer, { map: m, doc, onEditBrick }));

    let map = projectDoc(doc)!;
    await act(async () => root.render(render(map)));
    expect(prims).toBeGreaterThanOrEqual(N);

    // Parent re-render with the same map (pan / zoom / marquee / HUD).
    prims = 0;
    await act(async () => root.render(render(map)));
    expect(prims).toBe(0);

    // Selecting one brick re-renders the layer groups + that one glyph.
    prims = 0;
    await act(async () => useEditorStore.getState().setSelection([ids[0]!]));
    expect(prims).toBeLessThan(10);

    // Moving one brick: new projection, but only that glyph re-renders.
    moveBrick(doc, layerId, ids[5]!, 3, 3);
    const next = projectDoc(doc)!;
    expect(next).not.toBe(map);
    map = next;
    prims = 0;
    await act(async () => root.render(render(map)));
    expect(prims).toBeLessThan(10);

    // A snap starting re-renders only the selected glyph (its halo turns
    // green); further live-snap updates during the drag touch no glyph.
    prims = 0;
    await act(async () => useEditorStore.getState().setLiveSnap({ studX: 1, studY: 0 }));
    expect(prims).toBeGreaterThan(0);
    expect(prims).toBeLessThan(10);
    prims = 0;
    await act(async () => useEditorStore.getState().setLiveSnap({ studX: 2, studY: 0 }));
    expect(prims).toBe(0);
    await act(async () => useEditorStore.getState().setLiveSnap(null));

    await act(async () => root.unmount());
  });
});
