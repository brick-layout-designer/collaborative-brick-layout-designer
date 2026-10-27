// The picked parts' halos and connection dots, drawn by one shape over the
// parts, as the desktop's SelectionOverlay does (ui/SelectionOverlay.cpp),
// instead of as nodes inside every part. Picking all of a big layout
// (Select all on about a thousand parts) used to re-render every part and
// make two halo shapes for each; now no part re-renders and this one
// shape draws them all.
//
// The shape reads where each part is from its own node at draw time, so a
// halo follows a part however it moves (a drag, a live pose). It draws
// only the parts on its own Konva layer: while parts are dragged they sit
// on the drag layer (liftForDrag), which gets a copy of this shape.

import type Konva from 'konva';
import type { Brick } from '@cld/model';
import { connectionHingeAngle } from '@cld/parts-catalog/browser';
import type { PartWire } from '../../api';
import { SELECTION } from './selectionStyle';
import { ringPoints } from './pickShape';

/** The overlay's node name (liftForDrag finds it by this). */
export const SELECTION_OVERLAY = 'selection-overlay';

/** What the overlay needs to know about one part; each part keeps its own up to date. */
export interface GlyphInfo {
  group: { readonly current: Konva.Group | null };
  brick: Brick;
  meta: PartWire | undefined;
  /** The picture's size on the map (px, unrotated). */
  spriteW: number;
  spriteH: number;
}

export interface SelectionDraw {
  glyphs: ReadonlyMap<string, GlyphInfo>;
  /** Parts that get a halo. */
  haloIds: readonly string[];
  /** Parts whose free connection points get dots (none while the view draws every part's own). */
  dotIds: readonly string[];
  /** The halo's inner stroke and fill (selectionHalo). */
  colors: () => { stroke: string; fill: string };
  /** The select tool is on: a hinged part shows bend handles, not dots. */
  bendHandles: boolean;
}

type Pt = { x: number; y: number };

/** The corners (or outline rings) of a part's halo, in the part's own px. */
export function haloOutline(info: Pick<GlyphInfo, 'meta' | 'spriteW' | 'spriteH'>): Pt[][] {
  const rings = info.meta?.pickShape;
  if (rings) {
    return rings.map((ring) => {
      const flat = ringPoints(ring, 8);
      const out: Pt[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! });
      return out;
    });
  }
  const x = info.spriteW / 2 + SELECTION.partPadPx;
  const y = info.spriteH / 2 + SELECTION.partPadPx;
  return [[{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }]];
}

/** The free connection points of a picked part that get a dot, in its own px; `active` is the bigger gold one. */
export function connectionDots(brick: Brick, meta: PartWire | undefined, bendHandles: boolean): { x: number; y: number; active: boolean }[] {
  if (!meta) return [];
  // A picked flex track (or other hinged part) shows bend handles on its free ends instead.
  if (bendHandles && meta.connections.length <= 2 && meta.connections.some((c) => connectionHingeAngle(c.type) !== 0)) return [];
  const out: { x: number; y: number; active: boolean }[] = [];
  meta.connections.forEach((cp, ci) => {
    // Non-numeric types are custom joints that never snap (SceneBuilder.cpp:262-267).
    if (!cp.type || !/^\d+$/.test(cp.type)) return;
    const link = brick.connexions[ci];
    if (link && link.linkedTo !== '') return;
    out.push({ x: cp.x * 8, y: cp.y * 8, active: ci === brick.activeConnectionPointIndex });
  });
  return out;
}

/**
 * Draws the halos and dots of `s` for the parts on `shape`'s layer; returns
 * how many parts it drew. Strokes are in screen px at any zoom, like the
 * desktop's cosmetic pens; dots scale with the map, as before.
 */
export function drawSelection(ctx: Konva.Context, shape: Konva.Shape, s: SelectionDraw): number {
  // What it drew last, on the node, for the browser tests (which can't see pixels as nodes).
  const record = (drawn: SelectionDrawn) => {
    (shape.attrs as { drawn?: SelectionDrawn }).drawn = drawn;
  };
  if (s.haloIds.length === 0 && s.dotIds.length === 0) {
    record({ halos: 0, dots: 0, stroke: null });
    return 0;
  }
  const layer = shape.getLayer();
  const pr = ctx.getCanvas().getPixelRatio();
  const c = ctx._context;
  // Everything is worked out in device px, from each part's absolute transform.
  const on = (id: string): { info: GlyphInfo; m: number[] } | null => {
    const info = s.glyphs.get(id);
    const g = info?.group.current;
    if (!info || !g || g.getLayer() !== layer) return null;
    return { info, m: g.getAbsoluteTransform().getMatrix() };
  };
  const at = (m: number[], p: Pt): Pt => ({ x: pr * (m[0]! * p.x + m[2]! * p.y + m[4]!), y: pr * (m[1]! * p.x + m[3]! * p.y + m[5]!) });
  let drawn = 0;
  let dots = 0;
  let stroke: string | null = null;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.lineJoin = 'miter';

  // Dots first: a part's halo fill goes over its dots, as it did in the part.
  if (s.dotIds.length && typeof Path2D !== 'undefined') {
    const plain = new Path2D();
    const active = new Path2D();
    let any = false;
    for (const id of s.dotIds) {
      const hit = on(id);
      if (!hit) continue;
      const scale = Math.hypot(hit.m[0]!, hit.m[1]!) * pr;
      for (const d of connectionDots(hit.info.brick, hit.info.meta, s.bendHandles)) {
        const p = at(hit.m, d);
        const r = (d.active ? 13 : 10) * scale;
        const path = d.active ? active : plain;
        path.moveTo(p.x + r, p.y);
        path.arc(p.x, p.y, r, 0, Math.PI * 2);
        any = true;
        dots++;
      }
    }
    if (any) {
      c.fillStyle = 'rgb(230,40,40)';
      c.fill(plain);
      c.strokeStyle = 'rgb(255,255,255)';
      c.lineWidth = 2.5 * pr;
      c.stroke(plain);
      c.fillStyle = 'rgb(255,215,0)';
      c.fill(active);
      c.strokeStyle = 'rgb(30,30,30)';
      c.lineWidth = 3 * pr;
      c.stroke(active);
    }
  }

  if (s.haloIds.length) {
    const colors = s.colors();
    const fill = colors.fill;
    stroke = colors.stroke;
    for (const id of s.haloIds) {
      const hit = on(id);
      if (!hit) continue;
      const rings = haloOutline(hit.info);
      const picked = !!hit.info.meta?.pickShape;
      c.beginPath();
      for (const ring of rings) {
        ring.forEach((pt, i) => {
          const p = at(hit.m, pt);
          if (i === 0) c.moveTo(p.x, p.y);
          else c.lineTo(p.x, p.y);
        });
        c.closePath();
      }
      // The desktop's order per part: the dark outer outline, then the tint over it.
      c.strokeStyle = SELECTION.partOuter;
      c.lineWidth = SELECTION.partOuterWidth * pr;
      c.stroke();
      if (!picked) {
        // An imported part's outline is drawn without a fill, as before.
        c.fillStyle = fill;
        c.fill();
      }
      c.strokeStyle = colors.stroke;
      c.lineWidth = SELECTION.partInnerWidth * pr;
      c.stroke();
      drawn++;
    }
  }
  c.restore();
  record({ halos: drawn, dots, stroke: drawn > 0 ? stroke : null });
  return drawn;
}

/** What drawSelection drew last (on the overlay node as `drawn`). */
export interface SelectionDrawn {
  halos: number;
  dots: number;
  /** The halos' inner stroke, or null with none drawn. */
  stroke: string | null;
}
