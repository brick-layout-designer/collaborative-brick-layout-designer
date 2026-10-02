// An unknown part's placeholder must not be named like a brick: the
// "brick-<id>" name is how hit tests (touch editing) and look-ups find a
// brick's own group, and a nearer "brick-…" group inside it was taken
// for a brick called "unresolved".

import { describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';

const groups: string[] = [];
vi.mock('react-konva', () => {
  const plain = () => (p: { children?: ReactNode }) => h(Fragment, null, p.children);
  const Group = (p: { name?: string; children?: ReactNode }) => {
    if (p.name) groups.push(p.name);
    return h(Fragment, null, p.children);
  };
  return { Group, Image: plain(), Rect: plain(), Circle: plain(), Line: plain(), Text: plain() };
});

import { placeBrick } from '../mutations';
import { BrickLayer } from '../render/BrickLayer';
import { projectDoc } from '../useDocMap';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('an unknown part', () => {
  it('has one brick-named group, its own, and a placeholder named otherwise', async () => {
    const doc = createDefaultLayoutDoc();
    const layerId = docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
    const id = placeBrick(doc, layerId, { partNumber: 'NO_SUCH_PART.1', x: 0, y: 0, width: 4, height: 2 });
    const qc = new QueryClient();
    qc.setQueryData(['parts-catalog'], { parts: [] });
    const root = createRoot(document.createElement('div'));
    await act(async () =>
      root.render(h(QueryClientProvider, { client: qc }, h(BrickLayer, { map: projectDoc(doc)!, doc, onEditBrick: () => undefined }))),
    );
    expect(groups.filter((n) => n.startsWith('brick-'))).toEqual([`brick-${id}`]);
    expect(groups).toContain('unresolved-part');
    await act(async () => root.unmount());
  });
});
