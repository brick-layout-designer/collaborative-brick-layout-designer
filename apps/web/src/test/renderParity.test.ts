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

import TEXT from '../../../../packages/bbm/tests/fixtures/render-parity/text.json';
import { MAP_LINE_HEIGHT, textCellLayout } from '../editor/render/mapText';
import { fontStack } from '../editor/render/fontStack';

describe('render parity: text', () => {
  it.each(TEXT.cases)('lays out "$text" as the shared description says', (c) => {
    expect(textCellLayout(c, (l, px) => l.length * TEXT.charWidth * px)).toEqual(c.expect);
  });

  it('uses the shared line spacing and the bundled font', () => {
    expect(MAP_LINE_HEIGHT).toBe(TEXT.lineHeight);
    expect(fontStack('Tahoma')).toContain(TEXT.fontFamily);
  });
});

import PARTS from '../../../../packages/bbm/tests/fixtures/render-parity/parts.json';
import { unknownPartLook } from '../editor/render/unknownPart';

describe('render parity: parts the library does not know', () => {
  it.each(PARTS.cases)('draws "$partNumber" as the shared description says', (c) => {
    expect(unknownPartLook(c.partNumber, c.widthStuds, c.heightStuds)).toEqual(c.expect);
  });
});

import AREAS from '../../../../packages/bbm/tests/fixtures/render-parity/areas.json';
import { areaCellCss } from '../editor/render/AreaLayer';

describe('render parity: painted areas', () => {
  it.each(AREAS.cases)('draws $color at $transparency% as BlueBrick does', (c) => {
    const { r, g, b, a } = c.expect;
    expect(areaCellCss(c.color, c.transparency)).toBe(`rgba(${r}, ${g}, ${b}, ${a / 255})`);
  });
});

import SEL from '../../../../packages/bbm/tests/fixtures/render-parity/selection.json';
import { SELECTION, SNAP_MARKS, rulerHaloWidth } from '../editor/render/selectionStyle';
import { selectionHalo } from '../editor/render/BrickLayer';

describe('render parity: selection', () => {
  it('outlines a part as the shared description says', () => {
    expect(SELECTION.partPadPx).toBe(SEL.part.padPx);
    expect(SELECTION.partOuter).toBe(SEL.part.outer);
    expect(SELECTION.partOuterWidth).toBe(SEL.part.outerWidth);
    expect(SELECTION.partInnerWidth).toBe(SEL.part.innerWidth);
    expect(selectionHalo(SEL.part.tint.slice(1), false)).toEqual({
      stroke: SEL.part.tint,
      fill: `${SEL.part.tint}${SEL.part.fillAlpha.toString(16).toUpperCase()}`,
    });
    expect(selectionHalo('FFD700', true)).toEqual({ stroke: SEL.part.snapStroke, fill: SEL.part.snapFill });
  });

  it('makes text glow and rulers band as the shared description says', () => {
    expect(SELECTION.textGlow).toBe(SEL.text.glow);
    expect(SELECTION.textGlowBlur).toBe(SEL.text.blur);
    expect(SELECTION.rulerHalo).toBe(SEL.ruler.halo);
    for (const c of SEL.ruler.haloWidth) expect(rulerHaloWidth(c.thickness)).toBe(c.width);
    expect(SELECTION.handleRadius).toBe(SEL.ruler.handle.radius);
    expect(SELECTION.handleFill).toBe(SEL.ruler.handle.fill);
    expect(SELECTION.handleStroke).toBe(SEL.ruler.handle.stroke);
    expect(SELECTION.handleStrokeWidth).toBe(SEL.ruler.handle.strokeWidth);
  });

  it('marks a connection snap as the shared description says', () => {
    const { about: _about, ...marks } = SEL.snap;
    expect(SNAP_MARKS).toEqual(marks);
  });
});
