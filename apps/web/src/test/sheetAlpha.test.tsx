// A transparent sheet's alpha goes on each part, as vanilla BlueBrick draws
// it (LayerBrick.cs: every image with the alpha color matrix) and as the
// desktop does (per-item setOpacity), so the parts under a part show
// through. Fading the sheet as one picture made overlapping parts look solid.

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { ensureBrickLayer, placeBrick, setLayerTransparency } from '../editor/mutations';
import { BrickLayer } from '../editor/render/BrickLayer';
import { stubCanvas } from './konvaStub';

stubCanvas();

describe('sheet transparency', () => {
  it('fades each part, not the sheet as one picture', () => {
    const doc = new Y.Doc();
    const l = ensureBrickLayer(doc);
    placeBrick(doc, l, { partNumber: 'p', x: 0, y: 0, width: 8, height: 8 });
    placeBrick(doc, l, { partNumber: 'p', x: 4, y: 4, width: 8, height: 8 });
    setLayerTransparency(doc, l, 78);
    const map = docToBbm(doc);
    let stage: Konva.Stage | null = null;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    render(
      <QueryClientProvider client={client}>
        <Stage width={100} height={100} ref={(s) => { stage = s; }}>
          <Layer>
            <BrickLayer map={map} doc={doc} isViewer />
          </Layer>
        </Stage>
      </QueryClientProvider>,
    );
    const layer = map.layers.find((x) => x.type === 'brick');
    const ids = layer && layer.type === 'brick' ? layer.bricks.map((b) => b.id) : [];
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const part = stage!.findOne(`.brick-${id}`)!;
      expect(part.opacity()).toBeCloseTo(0.78);
      // Nothing above the part fades it again.
      for (let n = part.getParent(); n; n = n.getParent()) expect(n.opacity()).toBe(1);
    }
  });
});
