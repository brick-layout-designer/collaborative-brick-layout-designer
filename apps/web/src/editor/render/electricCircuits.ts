// Electric-circuit overlay geometry — the desktop's SceneBuilderElectric.cpp,
// drawn by ElectricCircuitLayer. BlueBrick's model (MapData/LayerBrick.cs
// draw, MapData/Tools/ElectricCircuitChecker.cs):
//
//   - A part's circuits join two of its connection points whose electric
//     plugs are opposite (+1 / -1, +2 / -2); 0 means no plug.
//   - Each circuit is drawn as two rails 2.5 studs either side of its path,
//     0.5 stud wide, at the layer's opacity. The path follows the track
//     (circuitPath.ts) instead of BlueBrick's straight chord.
//   - Polarity is propagated through linked connections, per layer, in
//     brick order (ElectricCircuitChecker.check(layer), as after loading a
//     file). `linkedTo` names the partner's *connection*. The first rail is
//     OrangeRed, the second Cyan, swapped when the circuit's first
//     connection has negative polarity.
//   - A circuit cutter (862AC01/02) breaks the second rail in the middle,
//     with two orange bars.
//   - A short circuit (the same polarity met from both sides) gets an
//     orange diamond at the connection.

import type { BbmMap, Brick, LayerBrick } from '@cld/model';
import type { PartWire } from '../../api';
import { pivotOf } from '../brickGeometry';
import {
  CIRCUIT_CUTTER_GAP,
  CIRCUIT_CUTTER_PEN,
  CIRCUIT_PEN_WIDTH,
  CIRCUIT_RAIL_OFFSET,
  CIRCUIT_SHORTCUT_SIZE,
  circuitPath,
  offsetPath,
  offsetPathBetween,
  pointAt,
  type Pt,
} from './circuitPath';

const PX = 8; // studs → pixels (standard pxPerStud)

export interface Circuit {
  index1: number;
  index2: number;
}

/** Circuits of a part: pairs of connections with opposite, non-zero plugs. */
export function deriveCircuits(connections: PartWire['connections']): Circuit[] {
  const out: Circuit[] = [];
  for (let i = 0; i < connections.length - 1; i++) {
    const plug = connections[i]!.electricPlug;
    if (!plug) continue;
    for (let j = i + 1; j < connections.length; j++) {
      if (connections[j]!.electricPlug === -plug) out.push({ index1: i, index2: j });
    }
  }
  return out;
}

interface Entry {
  brick: Brick;
  part: PartWire;
  circuits: Circuit[];
  polarity: number[];
  shortcut: boolean[];
}

export interface ElectricStroke {
  /** Flat x, y list in world pixels. */
  points: number[];
  color: string;
  /** World pixels. */
  width: number;
}

export interface ElectricOverlay {
  /** Rails, cutter bars and short-circuit diamonds, in drawing order. */
  strokes: ElectricStroke[];
}

/** ElectricCircuitChecker.check(LayerBrick): one time stamp for the layer, bricks explored in order. */
function checkPolarity(entries: Entry[]): void {
  const owner = new Map<string, { e: number; i: number }>();
  entries.forEach((entry, e) => {
    entry.brick.connexions.forEach((c, i) => {
      if (c.id && i < entry.polarity.length) owner.set(c.id, { e, i });
    });
  });
  const link = (e: number, i: number) => {
    const to = entries[e]!.brick.connexions[i]?.linkedTo;
    return to ? owner.get(to) : undefined;
  };
  const stamp = 2;
  entries.forEach((startEntry, start) => {
    if (Math.abs(startEntry.polarity[0] ?? 0) === stamp) return;
    const shortcuts: { e: number; i: number }[] = [];
    const explore = [start];
    const first = startEntry.circuits[0]!.index1;
    startEntry.polarity[first] = stamp;
    const l0 = link(start, first);
    if (l0) {
      entries[l0.e]!.polarity[l0.i] = -stamp;
      explore.push(l0.e);
    }
    while (explore.length > 0) {
      const e = explore.shift()!;
      const pol = entries[e]!.polarity;
      let reexplore = false;
      for (const circuit of entries[e]!.circuits) {
        let s = circuit.index1;
        let t = circuit.index2;
        if (Math.abs(pol[t]!) === stamp) [s, t] = [t, s];
        if (Math.abs(pol[s]!) !== stamp) {
          reexplore = true;
          continue;
        }
        if (pol[t] === pol[s]) {
          shortcuts.push({ e, i: s });
        } else if (pol[t] !== -pol[s]!) {
          pol[t] = -pol[s]!;
          if (reexplore) {
            explore.unshift(e);
            reexplore = false;
          }
          const l = link(e, t);
          if (l) {
            const other = entries[l.e]!.polarity;
            if (other[l.i] === pol[t]) {
              shortcuts.push({ e, i: t });
            } else if (other[l.i] !== -pol[t]!) {
              other[l.i] = -pol[t]!;
              explore.push(l.e);
            }
          }
        }
      }
    }
    for (const { e, i } of shortcuts) entries[e]!.shortcut[i] = true;
  });
}

const isCircuitCutter = (partNumber: string) => /^862AC0[12]\.7$/i.test(partNumber);

const flat = (pts: readonly Pt[]) => pts.flatMap((p) => [p.x * PX, p.y * PX]);

/** The overlay of every visible brick layer of `map`. */
export function electricOverlay(map: BbmMap, partsByKey: Map<string, PartWire>): ElectricOverlay {
  const strokes: ElectricStroke[] = [];
  for (const layer of map.layers) {
    if (layer.type !== 'brick' || layer.visible === false) continue;
    strokes.push(...layerOverlay(layer, partsByKey));
  }
  return { strokes };
}

function layerOverlay(layer: LayerBrick, partsByKey: Map<string, PartWire>): ElectricStroke[] {
  const entries: Entry[] = [];
  for (const brick of layer.bricks) {
    const part = partsByKey.get(brick.partNumber.toLowerCase());
    if (!part) continue;
    const circuits = deriveCircuits(part.connections);
    if (circuits.length === 0) continue;
    entries.push({
      brick,
      part,
      circuits,
      polarity: new Array<number>(part.connections.length).fill(0),
      shortcut: new Array<boolean>(part.connections.length).fill(false),
    });
  }
  if (entries.length === 0) return [];
  checkPolarity(entries);

  const alpha = Math.floor((255 * (layer.transparency ?? 100)) / 100) / 255;
  const red = `rgba(255,69,0,${alpha})`; // OrangeRed
  const blue = `rgba(0,255,255,${alpha})`; // Cyan
  const orange = `rgba(255,165,0,${alpha})`; // Orange
  const rail = CIRCUIT_PEN_WIDTH * PX;
  const out: ElectricStroke[] = [];

  for (const e of entries) {
    const centre = pivotOf(e.brick, e.part);
    const r = (e.brick.orientation * Math.PI) / 180;
    const world = (i: number): Pt => {
      const c = e.part.connections[i]!;
      return { x: centre.x + c.x * Math.cos(r) - c.y * Math.sin(r), y: centre.y + c.x * Math.sin(r) + c.y * Math.cos(r) };
    };
    const angle = (i: number) => e.brick.orientation + e.part.connections[i]!.angle;
    for (const { index1, index2 } of e.circuits) {
      const path = circuitPath(world(index1), angle(index1), world(index2), angle(index2));
      if (path.length < 2) continue;
      const swapped = e.polarity[index1]! < 0;
      out.push({ points: flat(offsetPath(path, CIRCUIT_RAIL_OFFSET)), color: swapped ? blue : red, width: rail });
      const second = swapped ? red : blue;
      const length = path[path.length - 1]!.s;
      if (isCircuitCutter(e.brick.partNumber) && length > 2 * CIRCUIT_CUTTER_GAP) {
        const g = CIRCUIT_CUTTER_GAP;
        out.push({ points: flat(offsetPathBetween(path, -CIRCUIT_RAIL_OFFSET, 0, g)), color: second, width: rail });
        out.push({ points: flat(offsetPathBetween(path, -CIRCUIT_RAIL_OFFSET, length - g, length)), color: second, width: rail });
        for (const s of [g, length - g]) {
          const at = pointAt(path, s);
          // From the centreline across the cut rail (BlueBrick: middle ± normal).
          const across = { x: at.p.x - at.normal.x * 2 * CIRCUIT_RAIL_OFFSET, y: at.p.y - at.normal.y * 2 * CIRCUIT_RAIL_OFFSET };
          out.push({ points: flat([at.p, across]), color: orange, width: CIRCUIT_CUTTER_PEN * PX });
        }
      } else {
        out.push({ points: flat(offsetPath(path, -CIRCUIT_RAIL_OFFSET)), color: second, width: rail });
      }
    }
  }

  // The shortcut sign at a shorted connection of each circuit (its first connection if both are).
  const w = CIRCUIT_SHORTCUT_SIZE;
  for (const e of entries) {
    const centre = pivotOf(e.brick, e.part);
    const r = (e.brick.orientation * Math.PI) / 180;
    for (const { index1, index2 } of e.circuits) {
      const index = e.shortcut[index1] ? index1 : e.shortcut[index2] ? index2 : -1;
      if (index < 0) continue;
      const cp = e.part.connections[index]!;
      const c = { x: centre.x + cp.x * Math.cos(r) - cp.y * Math.sin(r), y: centre.y + cp.x * Math.sin(r) + cp.y * Math.cos(r) };
      const diamond = [
        { x: c.x - w, y: c.y },
        { x: c.x, y: c.y - w },
        { x: c.x + w, y: c.y },
        { x: c.x, y: c.y + w },
        { x: c.x - w, y: c.y },
      ];
      out.push({ points: flat(diamond), color: orange, width: CIRCUIT_CUTTER_PEN * PX });
    }
  }
  return out;
}
