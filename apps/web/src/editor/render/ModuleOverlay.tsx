// Module name labels + frame outlines — port of SceneBuilderSidecar.cpp
// module rendering (view/moduleNames + view/moduleFrameThickness).
//
// Each sidecar module has a `members` array of brick IDs. We compute the
// AABB of all member bricks, draw a dashed outline around it (frame), and
// place the module name outside the frame, centred on a long side, sized
// as `moduleLabelPercent`% of the long axis (SceneBuilderSidecar.cpp:242-368).
// Desktop also dodges other modules' labels; we keep the first slot.

import Konva from 'konva';
import { Group, Rect, Text } from 'react-konva';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { useEditorStore } from '../editorStore';
import { studToPx } from './coords';

interface Props {
  map: BbmMap;
  modules: SidecarModule[];
}

/**
 * Module name font size in scene px: `percent`% of the frame's long axis,
 * clamped to 16..400 px like desktop.
 */
export function moduleLabelFontPx(frameWpx: number, frameHpx: number, percent: number): number {
  const longAxis = Math.max(frameWpx, frameHpx);
  const pct = Math.max(5, Math.min(100, percent));
  return Math.round(Math.max(16, Math.min(400, longAxis * (pct / 100))));
}

/**
 * The whole name always shows: when it is wider than the frame side at
 * `fontPx`, the font shrinks to fit (down to 60% of `fontPx`, and never
 * under 16 px), and if it is still wider the label grows past the frame
 * ends, centred on the side.
 */
export function fitModuleLabel(
  textWidthAt: (fontPx: number) => number,
  fontPx: number,
  sideLength: number,
): { fontPx: number; width: number } {
  const natural = textWidthAt(fontPx);
  if (natural <= sideLength) return { fontPx, width: sideLength };
  const smallest = Math.max(16, Math.round(fontPx * 0.6));
  const fitted = Math.max(smallest, Math.floor((fontPx * sideLength) / natural));
  const width = Math.max(sideLength, Math.ceil(textWidthAt(fitted)) + 2);
  return { fontPx: fitted, width };
}

function measureBold(text: string): (fontPx: number) => number {
  return (fontPx) => new Konva.Text({ text, fontSize: fontPx, fontStyle: 'bold' }).width();
}

/** Where one module's frame and name go, in scene px. */
export interface ModuleLabelLayout {
  id: string;
  name: string;
  frame: { x: number; y: number; width: number; height: number };
  /** The name's anchor; portrait names turn -90° about it. */
  text: { x: number; y: number; rotation: number; width: number; fontPx: number };
  /** Frame and name together. */
  bounds: { x: number; y: number; width: number; height: number };
}

const PAD = 4;
const GAP = 16; // desktop padOut

/**
 * Lay out every module's frame and name (the drawing below and the fits
 * that must show the names use the same numbers).
 */
export function moduleLabelLayouts(
  map: BbmMap,
  modules: readonly SidecarModule[],
  labelPercent: number,
  measure: (text: string) => (fontPx: number) => number = measureBold,
): ModuleLabelLayout[] {
  if (modules.length === 0) return [];
  // Index brick positions by id.
  const brickById = new Map<string, { x: number; y: number; w: number; h: number }>();
  // Bricks on hidden sheets don't frame or name their module.
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || !layer.visible) continue;
    for (const b of layer.bricks) {
      brickById.set(b.id, { x: b.displayArea.x, y: b.displayArea.y, w: b.displayArea.width, h: b.displayArea.height });
    }
  }
  const pxPerStud = studToPx();
  const out: ModuleLabelLayout[] = [];
  for (const mod of modules) {
    // Compute AABB of member bricks in studs.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of mod.members) {
      const b = brickById.get(id);
      if (!b) continue;
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) continue;

    const px = minX * pxPerStud;
    const py = minY * pxPerStud;
    const pw = (maxX - minX) * pxPerStud;
    const ph = (maxY - minY) * pxPerStud;
    const portrait = ph > pw;
    const name = mod.name || '(module)';
    const baseFontPx = moduleLabelFontPx(pw, ph, labelPercent);
    // Landscape: centred above the frame. Portrait: rotated along the
    // left edge, reading bottom-to-top.
    const side = portrait ? ph + PAD * 2 : pw + PAD * 2;
    const { fontPx, width: labelW } = fitModuleLabel(measure(name), baseFontPx, side);
    // A label wider than its side stays centred on it.
    const over = (labelW - side) / 2;
    const frame = { x: px - PAD, y: py - PAD, width: pw + PAD * 2, height: ph + PAD * 2 };
    const text = portrait
      ? { x: px - PAD - GAP - fontPx, y: py + ph + PAD + over, rotation: -90, width: labelW, fontPx }
      : { x: px - PAD - over, y: py - PAD - GAP - fontPx, rotation: 0, width: labelW, fontPx };
    // The name's own box: a turned name runs up from its anchor.
    const nameBox = portrait
      ? { x: text.x, y: text.y - labelW, width: fontPx, height: labelW }
      : { x: text.x, y: text.y, width: labelW, height: fontPx };
    const x0 = Math.min(frame.x, nameBox.x);
    const y0 = Math.min(frame.y, nameBox.y);
    const x1 = Math.max(frame.x + frame.width, nameBox.x + nameBox.width);
    const y1 = Math.max(frame.y + frame.height, nameBox.y + nameBox.height);
    out.push({ id: mod.id, name, frame, text, bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
  }
  return out;
}

/** Every module's frame and name together, in studs (for fitting the view). */
export function moduleLabelBoundsStuds(
  map: BbmMap,
  modules: readonly SidecarModule[],
  labelPercent: number,
  measure?: (text: string) => (fontPx: number) => number,
): { x: number; y: number; width: number; height: number }[] {
  const k = studToPx();
  return moduleLabelLayouts(map, modules, labelPercent, measure).map(({ bounds: b }) => ({
    x: b.x / k,
    y: b.y / k,
    width: b.width / k,
    height: b.height / k,
  }));
}

export function ModuleOverlay({ map, modules }: Props) {
  const showModuleNames = useEditorStore((s) => s.showModuleNames);
  const frameThickness = useEditorStore((s) => s.moduleFrameThickness);
  const labelPercent = useEditorStore((s) => s.moduleLabelPercent);

  // Names and frames share one toggle, like desktop view/moduleNames.
  if (!showModuleNames || modules.length === 0) return null;

  return (
    <Group listening={false}>
      {moduleLabelLayouts(map, modules, labelPercent).map(({ id, name, frame, text }) => (
        <Group key={id}>
          <Rect
            {...frame}
            stroke="rgba(100,180,255,0.8)"
            strokeWidth={frameThickness}
            strokeScaleEnabled={false}
            dash={[6, 4]}
            fillEnabled={false}
            perfectDrawEnabled={false}
          />
          <Text
            x={text.x}
            y={text.y}
            rotation={text.rotation}
            width={text.width}
            align="center"
            wrap="none"
            text={name}
            fontSize={text.fontPx}
            fontStyle="bold"
            fill="rgba(100,180,255,0.9)"
            stroke="rgba(0,0,0,0.6)"
            strokeWidth={Math.max(2, text.fontPx / 12)}
            fillAfterStrokeEnabled
            perfectDrawEnabled={false}
          />
        </Group>
      ))}
    </Group>
  );
}
