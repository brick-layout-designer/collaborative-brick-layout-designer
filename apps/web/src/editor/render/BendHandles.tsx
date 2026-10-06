// Bend handles — the desktop's MapView::refreshBendHandles /
// paintBendHandles / startBendFromHandle. When the selection holds a
// flexible run (flex track sets, magnet couplings, hinges), a round handle
// sits on each of its free ends; dragging one bends the run (BlueBrick's
// solver, each hinge within its limit) so that end follows the pointer,
// by mouse or finger.

import { useEffect, useMemo, useState } from 'react';
import { Arc, Circle, Group } from 'react-konva';
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

interface Props {
  map: BbmMap;
  doc: Y.Doc;
  selection: readonly string[];
  partsByKey: Map<string, PartWire>;
  modules: readonly SidecarModule[];
  editingModuleId: string | null;
  zoom: number;
  touch: boolean;
}

export function BendHandles({ map, doc, selection, partsByKey, modules, editingModuleId, zoom, touch }: Props) {
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

  // Screen size, whatever the zoom; bigger under a finger.
  const r = (touch ? 22 : 9) / zoom;
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
          <Circle radius={r} fill="#ffd700" stroke="#ffffff" strokeWidth={2 / zoom} shadowColor="#000" shadowBlur={4 / zoom} shadowOpacity={0.35} />
          {/* A curved arrow: bend. */}
          <Arc innerRadius={r * 0.45} outerRadius={r * 0.6} angle={240} rotation={150} fill="#141414" listening={false} />
        </Group>
      ))}
    </Group>
  );
}
