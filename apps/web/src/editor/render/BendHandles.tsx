// Bend handles — the desktop's MapView::refreshBendHandles /
// paintBendHandles / startBendFromHandle. When the selection holds a
// flexible run (flex track sets, magnet couplings, hinges), a round handle
// sits on each of its free ends; dragging one bends the run (BlueBrick's
// solver, each hinge within its limit) so that end follows the pointer,
// by mouse or finger.

import { useEffect, useMemo, useState } from 'react';
import { Group, Shape } from 'react-konva';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type * as Y from 'yjs';
import type { BbmMap, LayerBrick } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { connectionHingeAngle } from '@cld/parts-catalog/browser';
import type { PartWire } from '../../api';
import { connectionWorld, type Pt } from '../brickGeometry';
import { startFlexSession } from '../flexSession';
import { pinnedAmong } from '../moduleEdit';
import { useEditorStore } from '../editorStore';
import { EXPORT_HIDE } from '../exportRender';

const PX = 8;

/** A free end of a flexible run, where a bend handle sits. */
export interface FlexEnd {
  layerId: string;
  /** The brick at the end. */
  brickId: string;
  /** Its free connection. */
  connection: number;
  /** Where that connection is, studs. */
  world: Pt;
  /** Every brick of the run. */
  run: string[];
}

/**
 * The flexible runs through the selected bricks: every brick with a hinged
 * connection (and at most two connections) reachable through linked
 * connections from a selected one, so a chain of flex track sets is one
 * run. Returns their free ends — none for a run joined at both ends.
 */
export function flexRunEnds(map: Pick<BbmMap, 'layers'>, selection: readonly string[], parts: ReadonlyMap<string, PartWire>): FlexEnd[] {
  const want = new Set(selection);
  const out: FlexEnd[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || layer.visible === false) continue;
    out.push(...layerRunEnds(layer, want, parts));
  }
  return out;
}

function layerRunEnds(layer: LayerBrick, want: ReadonlySet<string>, parts: ReadonlyMap<string, PartWire>): FlexEnd[] {
  const partOf = (partNumber: string) => parts.get(partNumber.toLowerCase());
  const flexible = (partNumber: string) => {
    const p = partOf(partNumber);
    return !!p && p.connections.length > 0 && p.connections.length <= 2 && p.connections.some((c) => connectionHingeAngle(c.type) !== 0);
  };
  const owner = new Map<string, string>(); // connection id -> brick id
  const byId = new Map(layer.bricks.map((b) => [b.id, b]));
  for (const b of layer.bricks) for (const c of b.connexions) if (c.id) owner.set(c.id, b.id);
  const run = new Set<string>();
  const todo: string[] = [];
  for (const b of layer.bricks) {
    if (want.has(b.id) && flexible(b.partNumber)) {
      run.add(b.id);
      todo.push(b.id);
    }
  }
  while (todo.length > 0) {
    const b = byId.get(todo.pop()!)!;
    for (const c of b.connexions) {
      const next = c.linkedTo ? owner.get(c.linkedTo) : undefined;
      if (!next || run.has(next) || !flexible(byId.get(next)!.partNumber)) continue;
      run.add(next);
      todo.push(next);
    }
  }
  const ends: FlexEnd[] = [];
  const runIds = [...run];
  for (const b of layer.bricks) {
    if (!run.has(b.id)) continue;
    const p = partOf(b.partNumber)!;
    p.connections.forEach((c, i) => {
      if (!c.type || b.connexions[i]?.linkedTo) return;
      ends.push({ layerId: layer.id, brickId: b.id, connection: i, world: connectionWorld(b, p, i), run: runIds });
    });
  }
  return ends;
}

/**
 * A bend handle's size on screen, px, the same at every zoom: a small ring
 * for the mouse, a bigger one under a finger, and the area that grabs it
 * (a 44 px target on touch).
 */
export const BEND_HANDLE_PX = { ring: { mouse: 9, touch: 12 }, hit: { mouse: 12, touch: 22 } } as const;

/** Scene units for `screenPx` on screen, at the node's absolute scale. */
export function sceneRadius(screenPx: number, absoluteScale: number): number {
  return screenPx / Math.max(Math.abs(absoluteScale), 1e-6);
}

type Ctx = Pick<Konva.Context, 'beginPath' | 'arc' | 'closePath' | 'fillStrokeShape' | 'moveTo' | 'lineTo'>;
type ScaledShape = Pick<Konva.Shape, 'getAbsoluteScale'>;

/** Draws (or hit-tests) a circle `screenPx` across on screen, whatever the scale. */
export function handleCircle(screenPx: number) {
  return (ctx: Ctx, shape: ScaledShape) => {
    const r = sceneRadius(screenPx, shape.getAbsoluteScale().x);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2, false);
    ctx.closePath();
    ctx.fillStrokeShape(shape as Konva.Shape);
  };
}

/** The curved arrow inside a handle of `screenPx` radius. */
export function handleArrow(screenPx: number) {
  return (ctx: Ctx, shape: ScaledShape) => {
    const r = sceneRadius(screenPx, shape.getAbsoluteScale().x) * 0.55;
    const from = (200 * Math.PI) / 180;
    const to = (340 * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(0, 0, r, from, to, false);
    const tip = { x: r * Math.cos(to), y: r * Math.sin(to) };
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - r * 0.55, tip.y - r * 0.1);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - r * 0.1, tip.y + r * 0.55);
    ctx.fillStrokeShape(shape as Konva.Shape);
  };
}

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  selection: readonly string[];
  partsByKey: Map<string, PartWire>;
  modules: readonly SidecarModule[];
  editingModuleId: string | null;
  /** Kept for the callers; the handle reads the stage's scale as it draws. */
  zoom?: number;
  touch: boolean;
}

export function BendHandles({ map, doc, selection, partsByKey, modules, editingModuleId, touch }: Props) {
  const [bending, setBending] = useState(false);
  const ends = useMemo(
    () => flexRunEnds(map, selection, partsByKey).filter((e) => !pinnedAmong(e.run, modules, editingModuleId)),
    [map, selection, partsByKey, modules, editingModuleId],
  );
  // The first time, a tip says what the handle does.
  const shown = ends.length > 0 && !bending;
  useEffect(() => {
    if (!shown) return;
    try {
      if (localStorage.getItem('cld:hint:bendHandle')) return;
      localStorage.setItem('cld:hint:bendHandle', '1');
    } catch {
      /* no storage: say it anyway */
    }
    useEditorStore.getState().showStatusMessage('Drag the round handle at the end of the flex track to bend it', 8000);
  }, [shown]);
  if (!shown) return null;

  const ring = touch ? BEND_HANDLE_PX.ring.touch : BEND_HANDLE_PX.ring.mouse;
  const hit = touch ? BEND_HANDLE_PX.hit.touch : BEND_HANDLE_PX.hit.mouse;
  const start = (e: KonvaEventObject<MouseEvent | TouchEvent>, end: FlexEnd) => {
    if ('button' in e.evt && e.evt.button !== 0) return;
    e.cancelBubble = true;
    const stage = e.target.getStage();
    if (!stage) return;
    const started = startFlexSession({
      stage,
      doc,
      map,
      layerId: end.layerId,
      grabbedId: end.brickId,
      chain: end.run,
      activeConnection: end.connection,
      mouseStuds: end.world,
      partsByKey,
      modules,
      label: 'Bend flex track',
      onEnd: () => setBending(false),
    });
    if (started) setBending(true);
  };
  return (
    <Group name={EXPORT_HIDE}>
      {ends.map((end) => (
        <Group
          key={`${end.brickId}:${end.connection}`}
          x={end.world.x * PX}
          y={end.world.y * PX}
          onMouseDown={(e) => start(e, end)}
          onTouchStart={(e) => start(e, end)}
          onMouseEnter={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = 'grab';
          }}
          onMouseLeave={(e) => {
            const c = e.target.getStage()?.container();
            if (c) c.style.cursor = '';
          }}
        >
          {/* Drawn at the scale the stage has when it draws, so the
              handle stays the same size on screen at every zoom, also
              mid-pinch. */}
          <Shape
            sceneFunc={handleCircle(ring)}
            hitFunc={handleCircle(hit)}
            fill="#ffd700"
            stroke="#ffffff"
            strokeWidth={2}
            strokeScaleEnabled={false}
            shadowColor="#000"
            shadowBlur={4}
            shadowOpacity={0.35}
          />
          {/* A curved arrow: bend. */}
          <Shape sceneFunc={handleArrow(ring)} stroke="#141414" strokeWidth={1.6} strokeScaleEnabled={false} listening={false} />
        </Group>
      ))}
    </Group>
  );
}
