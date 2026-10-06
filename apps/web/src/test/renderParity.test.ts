// The module look the desktop must draw too: both apps check their module
// frames and names against packages/bbm/tests/fixtures/render-parity/
// modules.json (the desktop's tests/ui/RenderParityTest.cpp reads its copy).
// Names are measured with a fixed width per character, so fonts don't matter.

import { describe, expect, it } from 'vitest';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import SPEC from '../../../../packages/bbm/tests/fixtures/render-parity/modules.json';
import {
  MODULE_FRAME_ALPHA,
  MODULE_FRAME_DASH,
  MODULE_FRAME_PARTLY_HIDDEN_DASH,
  MODULE_FRAME_STROKE,
  MODULE_FULL_NAME_BG,
  MODULE_NAME_ALPHA,
  MODULE_NAME_FILL,
  MODULE_NAME_LINE_HEIGHT,
  MODULE_NAME_MIN_PX,
  MODULE_NAME_STROKE,
  fitModuleName,
  moduleLabelLayouts,
  moduleLook,
  moduleNameStrokePx,
} from '../editor/render/moduleLabels';

const fixedWidth = (t: string) => (f: number) => t.length * SPEC.charWidth * f;

describe('render parity: modules', () => {
  it.each(SPEC.cases)('lays out $name as the shared description says', (c) => {
    const map = { layers: [{ type: 'brick', visible: true, bricks: [{ id: 'b', displayArea: c.studs }] }] } as unknown as BbmMap;
    const mod = { id: 'm', name: c.name, members: ['b'], ...('module' in c ? c.module : {}) } as unknown as SidecarModule;
    const [got] = moduleLabelLayouts(map, [mod], c.labelPercent, fixedWidth);
    expect({ frame: got!.frame, ...(got!.text ? { text: got!.text } : {}), bounds: got!.bounds }).toEqual(c.expect);
  });

  it.each(SPEC.fit)('fits "$text" at $fontPx px on a $side px side as the shared description says', (c) => {
    const got = fitModuleName(c.text, fixedWidth, c.fontPx, c.side);
    expect(got).toEqual(c.expect);
    // Never longer than the side.
    for (const line of got.lines) expect(fixedWidth(line)(got.fontPx)).toBeLessThanOrEqual(c.side);
  });

  it.each(SPEC.looks)('draws a module with $module in the shared colours', (c) => {
    expect(moduleLook(c.module)).toEqual(c.expect);
  });

  it('draws the shared colours, dash and outline', () => {
    expect(MODULE_FRAME_STROKE).toBe(SPEC.style.frameStroke);
    expect(MODULE_FRAME_DASH).toEqual(SPEC.style.frameDash);
    expect(MODULE_FRAME_PARTLY_HIDDEN_DASH).toEqual(SPEC.style.partlyHiddenFrameDash);
    expect(MODULE_NAME_FILL).toBe(SPEC.style.nameFill);
    expect(MODULE_NAME_STROKE).toBe(SPEC.style.nameStroke);
    expect(MODULE_FULL_NAME_BG).toBe(SPEC.style.fullNameBackground);
    expect(MODULE_NAME_LINE_HEIGHT).toBe(SPEC.style.nameLineHeight);
    expect(MODULE_NAME_MIN_PX).toBe(SPEC.minFontPx);
    expect(MODULE_FRAME_ALPHA).toBe(SPEC.style.customFrameAlpha);
    expect(MODULE_NAME_ALPHA).toBe(SPEC.style.customNameAlpha);
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

import VENUE from '../../../../packages/bbm/tests/fixtures/render-parity/venue-labels.json';
import type { VenueEdge } from '@cld/bbm';
import { GRID_FADE } from '../venues/designer/DesignerCanvas';
import { VENUE_LABEL, VENUE_LABEL_THEME, pillsOverlap, uprightAngle, venueEdgeLabels } from '../editor/render/venueLabels';

describe('render parity: venue wall labels', () => {
  const measure = (t: string, f: number) => t.length * VENUE.charWidth * f;
  it.each(VENUE.cases)('$name', (c) => {
    const got = venueEdgeLabels(c.edges as VenueEdge[], {
      fontPx: c.fontPx,
      measure,
      ...('selectedEdge' in c ? { selectedEdge: c.selectedEdge } : {}),
      ...('handles' in c ? { handles: c.handles, handleHalfPx: c.handleHalfPx } : {}),
    });
    expect(got.length).toBe(c.expect.length);
    got.forEach((l, i) => {
      const w = c.expect[i]!;
      expect({ edge: l.edge, text: l.text, full: l.full, shortened: l.shortened, angle: l.angle }).toEqual({
        edge: w.edge,
        text: w.text,
        full: w.full,
        shortened: w.shortened,
        angle: w.angle,
      });
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(l[k]).toBeCloseTo(w[k], 4);
    });
  });

  it('draws the shared pill, colours and grid fade', () => {
    expect(VENUE_LABEL).toEqual(VENUE.pill);
    expect(VENUE_LABEL_THEME).toEqual(VENUE.theme);
    expect(GRID_FADE).toBe(VENUE.gridFade);
  });

  it('reads upright: left to right, bottom to top on a vertical wall, never upside down', () => {
    expect(uprightAngle(1, 0)).toBe(0);
    expect(uprightAngle(-1, 0)).toBeCloseTo(0);
    expect(uprightAngle(0, 1)).toBe(-90);
    expect(uprightAngle(0, -1)).toBe(-90);
    expect(uprightAngle(1, 1)).toBeCloseTo(45);
    expect(uprightAngle(-1, -1)).toBeCloseTo(45);
  });

  it('tells turned pills apart', () => {
    const a = { x: 0, y: 0, angle: 0, width: 10, height: 2 };
    expect(pillsOverlap(a, { x: 9, y: 0, angle: 0, width: 10, height: 2 })).toBe(true);
    expect(pillsOverlap(a, { x: 10, y: 0, angle: 0, width: 10, height: 2 })).toBe(false);
    expect(pillsOverlap(a, { x: 0, y: 4, angle: 90, width: 6, height: 2 })).toBe(true);
    expect(pillsOverlap(a, { x: 0, y: 5.5, angle: 90, width: 6, height: 2 })).toBe(false);
  });
});
