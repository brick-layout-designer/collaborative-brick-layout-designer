// The Venue Designer's drawing area: the floor plan, a feet grid, the venue
// (drawn by the editor's VenueOverlay so it looks the same as in a layout),
// the selection with its corner handles, and the shape being drawn with its
// live length. Mouse events become world points (studs) for the reducer.
// Wheel zooms at the pointer; middle or right drag (or Space + drag) pans.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Venue } from '@cld/bbm';
import { VenueOverlay } from '../../editor/render/VenueOverlay';
import { studToPx } from '../../editor/render/coords';
import { preview, venueOf, type Action, type DesignerState } from './designerState';
import { bbox, type Pt } from './model';
import { planOf, type FloorPlan } from './plan';
import { formatAngle, formatLength, STUDS_PER_INCH } from './units';

const FT = 12 * STUDS_PER_INCH;
const SELECT = '#2f6fed';
/** How close the pointer must be to pick or snap, in screen px. */
const HIT_PX = 8;

export interface View {
  scale: number; // screen px per stud
  x: number; // screen position of world 0,0
  y: number;
}

/** A view that shows `v` (or a 60 ft square when empty) filling `w` × `h` with a margin. */
export function fitView(v: Venue, w: number, h: number): View {
  const pts = [...v.edges.flatMap((e) => e.poly), ...v.obstacles.flatMap((o) => o.poly)];
  const plan = planOf(v);
  const b = pts.length ? bbox(pts) : { x0: 0, y0: 0, x1: 60 * FT, y1: 60 * FT };
  if (!pts.length && plan) Object.assign(b, { x0: plan.x, y0: plan.y, x1: plan.x + 60 * FT, y1: plan.y + 40 * FT });
  const bw = Math.max(b.x1 - b.x0, FT), bh = Math.max(b.y1 - b.y0, FT);
  const scale = Math.min((w - 80) / bw, (h - 80) / bh);
  return { scale, x: w / 2 - ((b.x0 + b.x1) / 2) * scale, y: h / 2 - ((b.y0 + b.y1) / 2) * scale };
}

/** The venue with hidden layers taken out, for drawing. */
function visibleVenue(v: Venue, show: DesignerState['show']): Venue {
  const est = (x: { estimated?: boolean }) => show.estimates || !x.estimated;
  const out: Venue = { ...v, enabled: true, edges: v.edges.filter(est), obstacles: show.obstacles ? v.obstacles : [] };
  if (!show.power) delete out.power;
  if (!show.notes) delete out.notes;
  else if (out.notes) out.notes = out.notes.filter(est);
  if (!show.dimensions) delete out.dimensions;
  else if (out.dimensions) out.dimensions = out.dimensions.filter(est);
  return out;
}

function useImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return setImg(null);
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = src;
    return () => {
      i.onload = null;
    };
  }, [src]);
  return img;
}

export function DesignerCanvas({
  state,
  dispatch,
  view,
  setView,
  planMoving,
  onPlanMoved,
  onCursor,
}: {
  state: DesignerState;
  dispatch: Dispatch<Action>;
  view: View | null;
  setView: (v: View) => void;
  /** Dragging moves the floor plan instead of using the tool. */
  planMoving: boolean;
  onPlanMoved: (plan: FloorPlan) => void;
  onCursor: (p: Pt | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const pan = useRef<{ sx: number; sy: number; view: View } | null>(null);
  const planDrag = useRef<{ sx: number; sy: number; plan: FloorPlan } | null>(null);
  const [space, setSpace] = useState(false);
  const venue = venueOf(state);
  const plan = planOf(venue);
  const planImg = useImage(plan?.image);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!view && size.w > 0) setView(fitView(venue, size.w, size.h));
  }, [view, size, venue, setView]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && !(e.target instanceof HTMLInputElement) && setSpace(true);
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const v = useMemo(() => view ?? { scale: 1, x: 0, y: 0 }, [view]);
  const toWorld = (sx: number, sy: number): Pt => ({ x: (sx - v.x) / v.scale, y: (sy - v.y) / v.scale });
  const tol = HIT_PX / v.scale;
  const shown = useMemo(() => visibleVenue(venue, state.show), [venue, state.show]);

  const pointer = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getPointerPosition();
    return pos ? { screen: pos, world: toWorld(pos.x, pos.y) } : null;
  };

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer(e);
    if (!p) return;
    if (e.evt.button === 1 || e.evt.button === 2 || space) {
      pan.current = { sx: p.screen.x, sy: p.screen.y, view: v };
      return;
    }
    if (e.evt.button !== 0) return;
    if (planMoving && plan) {
      planDrag.current = { sx: p.screen.x, sy: p.screen.y, plan };
      return;
    }
    dispatch({ type: 'down', at: p.world, tol, free: e.evt.shiftKey });
  };
  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer(e);
    if (!p) return;
    onCursor(p.world);
    if (pan.current) {
      const s = pan.current;
      setView({ ...s.view, x: s.view.x + p.screen.x - s.sx, y: s.view.y + p.screen.y - s.sy });
      return;
    }
    if (planDrag.current) {
      const d = planDrag.current;
      onPlanMoved({ ...d.plan, x: d.plan.x + (p.screen.x - d.sx) / v.scale, y: d.plan.y + (p.screen.y - d.sy) / v.scale });
      return;
    }
    dispatch({ type: 'move', at: p.world, tol, free: e.evt.shiftKey });
  };
  const onUp = () => {
    if (pan.current) pan.current = null;
    else if (planDrag.current) planDrag.current = null;
    else dispatch({ type: 'up' });
  };
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    const k = Math.exp(-e.evt.deltaY * (e.evt.ctrlKey ? 0.01 : 0.0015));
    const scale = Math.min(200, Math.max(0.02, v.scale * k));
    const w = toWorld(pos.x, pos.y);
    setView({ scale, x: pos.x - w.x * scale, y: pos.y - w.y * scale });
  };

  // Feet grid: 1 ft lines when they're at least 10 px apart, 10 ft lines always.
  const grid = useMemo(() => {
    const lines: { pts: number[]; major: boolean }[] = [];
    const x0 = -v.x / v.scale, y0 = -v.y / v.scale, x1 = (size.w - v.x) / v.scale, y1 = (size.h - v.y) / v.scale;
    const step = v.scale * FT >= 10 ? FT : 10 * FT;
    if ((x1 - x0) / step > 400) return lines;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step)
      lines.push({ pts: [x, y0, x, y1], major: Math.abs(Math.round(x / FT) % 10) === 0 });
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step)
      lines.push({ pts: [x0, y, x1, y], major: Math.abs(Math.round(y / FT) % 10) === 0 });
    return lines;
  }, [v, size]);

  const px = studToPx();
  const pv = preview(state);
  const sel = state.selection;
  const handles: Pt[] = (() => {
    if (!sel) return [];
    if (sel.kind === 'edge') return venue.edges[sel.index]?.poly ?? [];
    if (sel.kind === 'obstacle') return venue.obstacles[sel.index]?.poly ?? [];
    if (sel.kind === 'dimension') {
      const d = venue.dimensions?.[sel.index];
      return d ? [d.from, d.to] : [];
    }
    return [];
  })();
  const selOutline: Pt[] | null = (() => {
    if (!sel) return null;
    if (sel.kind === 'obstacle') return venue.obstacles[sel.index]?.poly ?? null;
    return null;
  })();
  const selPoint: Pt | null = (() => {
    if (sel?.kind === 'power') return venue.power?.[sel.index] ?? null;
    if (sel?.kind === 'note') return venue.notes?.[sel.index] ?? null;
    return null;
  })();
  const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);
  const hs = 5 / v.scale; // handle half-size, world
  const bubble = (at: Pt, text: string) => {
    const w = text.length * 7 + 16;
    return (
      <Group x={at.x * v.scale + v.x + 12} y={at.y * v.scale + v.y - 30} listening={false}>
        <Rect width={w} height={22} cornerRadius={4} fill={SELECT} />
        <Text x={8} y={5} text={text} fontSize={12} fontFamily="IBM Plex Sans, sans-serif" fill="#fff" />
      </Group>
    );
  };
  const snapColor = state.snapKind === 'corner' ? '#d9480f' : state.snapKind === 'wall' ? '#2b8a3e' : SELECT;
  const lineLabel = pv.line
    ? `${formatLength(pv.length ?? 0, state.unit)} · ${formatAngle((Math.atan2(pv.line[1].y - pv.line[0].y, pv.line[1].x - pv.line[0].x) * 180) / Math.PI)}`
    : pv.rect
      ? `${formatLength(Math.abs(pv.rect[1].x - pv.rect[0].x), state.unit)} × ${formatLength(Math.abs(pv.rect[1].y - pv.rect[0].y), state.unit)}`
      : pv.cut
        ? formatLength(pv.length ?? 0, state.unit)
        : null;

  return (
    <div
      ref={host}
      style={{ position: 'absolute', inset: 0, cursor: space || pan.current ? 'grab' : state.tool === 'select' ? 'default' : 'crosshair' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage width={size.w} height={size.h} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => onCursor(null)} onWheel={onWheel}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="#ffffff" />
          <Group x={v.x} y={v.y} scaleX={v.scale} scaleY={v.scale}>
            {plan && planImg && state.show.plan && (
              <KonvaImage
                image={planImg}
                x={plan.x}
                y={plan.y}
                width={planImg.naturalWidth * plan.studsPerPx}
                height={planImg.naturalHeight * plan.studsPerPx}
                opacity={plan.opacity}
              />
            )}
            {grid.map((g, i) => (
              <Line key={i} points={g.pts} stroke={g.major ? '#d5dae1' : '#eef0f3'} strokeWidth={1} strokeScaleEnabled={false} />
            ))}
            <Group scaleX={1 / px} scaleY={1 / px}>
              <VenueOverlay venue={shown} labelFontPx={(13 / v.scale) * px} />
            </Group>
            {selOutline && <Line points={flat(selOutline)} closed stroke={SELECT} strokeWidth={2} strokeScaleEnabled={false} />}
            {sel?.kind === 'edge' && venue.edges[sel.index] && (
              <Line points={flat(venue.edges[sel.index]!.poly)} stroke={SELECT} strokeWidth={3} strokeScaleEnabled={false} opacity={0.6} />
            )}
            {selPoint && <Circle x={selPoint.x} y={selPoint.y} radius={10 / v.scale} stroke={SELECT} strokeWidth={2} strokeScaleEnabled={false} />}
            {handles.map((h, i) => (
              <Rect key={i} x={h.x - hs} y={h.y - hs} width={hs * 2} height={hs * 2} fill="#fff" stroke={SELECT} strokeWidth={1.5} strokeScaleEnabled={false} />
            ))}
            {state.tool === 'wall' && state.draft.length > 1 && (
              <Line points={flat(state.draft)} stroke={SELECT} strokeWidth={2} strokeScaleEnabled={false} opacity={0.5} />
            )}
            {pv.line && <Line points={flat(pv.line)} stroke={SELECT} strokeWidth={2} dash={[6, 4]} strokeScaleEnabled={false} />}
            {pv.cut && <Line points={flat(pv.cut)} stroke={state.tool === 'door' ? 'rgb(0,160,0)' : 'rgb(0,0,200)'} strokeWidth={6} strokeScaleEnabled={false} />}
            {pv.rect && (
              <Rect
                x={Math.min(pv.rect[0].x, pv.rect[1].x)}
                y={Math.min(pv.rect[0].y, pv.rect[1].y)}
                width={Math.abs(pv.rect[1].x - pv.rect[0].x)}
                height={Math.abs(pv.rect[1].y - pv.rect[0].y)}
                stroke={SELECT}
                strokeWidth={2}
                dash={[6, 4]}
                strokeScaleEnabled={false}
              />
            )}
            {state.calibration.map((c, i) => (
              <Circle key={i} x={c.x} y={c.y} radius={6 / v.scale} fill="#d9480f" />
            ))}
            {state.calibration.length === 2 && (
              <Line points={flat(state.calibration)} stroke="#d9480f" strokeWidth={2} strokeScaleEnabled={false} />
            )}
            {state.pointer && state.tool !== 'select' && (
              <Circle x={state.pointer.x} y={state.pointer.y} radius={4 / v.scale} stroke={snapColor} strokeWidth={2} strokeScaleEnabled={false} />
            )}
          </Group>
          {lineLabel && state.pointer && bubble(state.pointer, state.typed ? `${lineLabel} · typing ${state.typed}` : lineLabel)}
        </Layer>
      </Stage>
    </div>
  );
}
