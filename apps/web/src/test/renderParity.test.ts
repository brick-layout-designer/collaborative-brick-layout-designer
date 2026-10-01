// The module look the desktop must draw too: both apps check their module
// frames and names against packages/bbm/tests/fixtures/render-parity/
// modules.json (the desktop's tests/ui/RenderParityTest.cpp reads its copy).
// Names are measured with a fixed width per character, so fonts don't matter.

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import SPEC from '../../../../packages/bbm/tests/fixtures/render-parity/modules.json';
import {
  MODULE_FRAME_DASH,
  MODULE_FRAME_STROKE,
  MODULE_NAME_FILL,
  MODULE_NAME_STROKE,
  moduleLabelLayouts,
  moduleNameStrokePx,
} from '../editor/render/moduleLabels';

describe('render parity: modules', () => {
  it.each(SPEC.cases)('lays out $name as the shared description says', (c) => {
    const map = { layers: [{ type: 'brick', visible: true, bricks: [{ id: 'b', displayArea: c.studs }] }] } as unknown as BbmMap;
    const mod = { id: 'm', name: c.name, members: ['b'] } as unknown as SidecarModule;
    const [got] = moduleLabelLayouts(map, [mod], c.labelPercent, (t) => (f) => t.length * SPEC.charWidth * f);
    expect({ frame: got!.frame, text: got!.text, bounds: got!.bounds }).toEqual(c.expect);
  });

  it('draws the shared colours, dash and outline', () => {
    expect(MODULE_FRAME_STROKE).toBe(SPEC.style.frameStroke);
    expect(MODULE_FRAME_DASH).toEqual(SPEC.style.frameDash);
    expect(MODULE_NAME_FILL).toBe(SPEC.style.nameFill);
    expect(MODULE_NAME_STROKE).toBe(SPEC.style.nameStroke);
    expect(moduleNameStrokePx(12)).toBe(2);
    expect(moduleNameStrokePx(120)).toBe(10);
  });
});
