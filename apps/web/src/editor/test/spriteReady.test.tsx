// Regression: opening a big layout. Every part asks for its picture; when a
// picture arrived, each part's own wait finished AND told every other part
// waiting on the same picture, so 5,000 parts sharing nine pictures made
// about 2.7 million re-renders (and ~800 MB of pending updates) on open.
// Now each part hears once, and a part whose picture is already loaded
// doesn't re-render after it mounts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import type { PartWire } from '../../api';

let prims = 0;
vi.mock('react-konva', () => {
  const mk = () => (p: { children?: ReactNode }) => {
    prims++;
    return h(Fragment, null, p.children);
  };
  return { Group: mk(), Image: mk(), Rect: mk(), Circle: mk(), Line: mk(), Text: mk(), Shape: mk() };
});

import { _resetSpriteCacheForTests, ensureSprite, onSpriteReady } from '../render/spriteCache';
import { placeBrick } from '../mutations';
import { BrickLayer } from '../render/BrickLayer';
import { projectDoc } from '../useDocMap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A stand-in Image whose loads the test finishes by hand.
const pending = new Map<string, FakeImage[]>();
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  naturalWidth = 16;
  naturalHeight = 8;
  width = 16;
  height = 8;
  set src(url: string) {
    pending.set(url, [...(pending.get(url) ?? []), this]);
  }
}
function finish(url: string) {
  for (const img of pending.get(url) ?? []) img.onload?.();
  pending.delete(url);
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  vi.stubGlobal('Image', FakeImage);
  pending.clear();
  _resetSpriteCacheForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe('a picture arriving', () => {
  it('tells each one waiting on it once, however many asked for it', async () => {
    const heard: number[] = new Array(500).fill(0);
    for (let i = 0; i < 500; i++) {
      onSpriteReady('/parts/track.png', () => heard[i]!++);
      void ensureSprite('/parts/track.png');
    }
    finish('/parts/track.png');
    await settle();
    // Each part heard once (it was 500 times each: 250,000 in all).
    expect(heard.reduce((a, b) => a + b, 0)).toBe(500);
  });
});

describe('BrickLayer and its pictures', () => {
  const part: PartWire = {
    key: 'track.0', partNumber: 'track', colorCode: '0', kind: 'leaf', description: 'Track', sortingKey: 'track',
    spritePath: 'track.png', pxPerStud: 8, category: 'Track', connections: [], subparts: [], hullPts: [],
  } as unknown as PartWire;

  function setup(n: number) {
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    doc.transact(() => {
      for (let i = 0; i < n; i++) placeBrick(doc, layerId, { partNumber: 'track.0', x: i * 16, y: 0, width: 16, height: 8 });
    });
    const qc = new QueryClient();
    qc.setQueryData(['parts-catalog'], { parts: [part] });
    const root = createRoot(document.createElement('div'));
    const map = projectDoc(doc)!;
    const render = () => root.render(h(QueryClientProvider, { client: qc }, h(BrickLayer, { map, doc })));
    return { render };
  }

  it('draws each part once more when its picture arrives, not once per other part', async () => {
    const N = 300;
    const { render } = setup(N);
    prims = 0;
    await act(async () => render());
    const mounted = prims;
    expect(mounted).toBeGreaterThanOrEqual(N);
    prims = 0;
    finish('/parts/track.png');
    await settle();
    // One re-render per part, to draw the picture (it was N per part).
    expect(prims).toBeGreaterThan(0);
    expect(prims).toBeLessThanOrEqual(mounted * 1.5);
  });

  it('a part whose picture is already loaded does not re-render after it mounts', async () => {
    void ensureSprite('/parts/track.png');
    finish('/parts/track.png');
    await settle();
    const { render } = setup(300);
    await act(async () => render());
    prims = 0;
    await settle();
    expect(prims).toBe(0);
  });
});
