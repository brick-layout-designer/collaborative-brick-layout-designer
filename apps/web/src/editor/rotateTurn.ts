// BlueBrick's RotateBrick for a selection joined to other track: instead of
// turning by the rotation step, the selection steps round its join to the
// fixed track, to its next free connection of that type, so it stays
// connected (Actions/Bricks/RotateBrick.cs; desktop edit/RotateTurn.cpp).

import type { Brick } from '@cld/model';
import { connectionWorld, type PartGeom, type Pt } from './brickGeometry';

export type TurnBrick = Pick<Brick, 'id' | 'displayArea' | 'orientation' | 'connexions'> & { part: PartGeom | undefined };

export interface ConnectedTurn {
  /** The turn that joins the new connection to the fixed one. */
  degrees: number;
  /** The picked part whose connection now joins, and that connection. */
  brickId: string;
  connection: number;
  /** Where the joined connection stays (studs). */
  at: Pt;
}

function clamp360(a: number): number {
  if (a >= 360) a -= 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * `selected` in sheet order, `all` every part on the map. `steps` > 0 goes on
 * to the next connection, < 0 back. Null when nothing outside the selection
 * is joined to it.
 */
export function connectedTurn(selected: readonly TurnBrick[], all: readonly TurnBrick[], steps: number): ConnectedTurn | null {
  if (selected.length === 0 || steps === 0) return null;
  const byId = new Map<string, { brick: TurnBrick; index: number }>();
  for (const b of all) b.connexions.forEach((c, index) => c.id && byId.set(c.id, { brick: b, index }));
  const picked = new Set(selected.map((b) => b.id));
  type Conn = { brick: TurnBrick; index: number };
  const available = new Map<string, Conn[]>();
  const external = new Map<string, Conn[]>();
  const typeOrder: string[] = [];
  for (const b of selected) {
    const conns = b.part?.connections ?? [];
    b.connexions.forEach((c, index) => {
      const type = conns[index]?.type;
      if (type === undefined) return;
      if (!typeOrder.includes(type)) typeOrder.push(type);
      const other = c.linkedTo ? byId.get(c.linkedTo) : undefined;
      if (!other) {
        available.set(type, [...(available.get(type) ?? []), { brick: b, index }]);
      } else if (!picked.has(other.brick.id)) {
        available.set(type, [...(available.get(type) ?? []), { brick: b, index }]);
        external.set(type, [...(external.get(type) ?? []), { brick: b, index }]);
      }
    });
  }
  // The type with the most joins outside (the first on a tie).
  let chosen = '';
  let best = 0;
  for (const t of typeOrder) {
    const n = external.get(t)?.length ?? 0;
    if (n > best) {
      best = n;
      chosen = t;
    }
  }
  if (best === 0) return null;
  const old = external.get(chosen)![0]!;
  const fixed = byId.get(old.brick.connexions[old.index]!.linkedTo)!;
  const list = available.get(chosen)!;
  const n = list.length;
  let index = list.findIndex((c) => c.brick === old.brick && c.index === old.index);
  index = (((index + steps) % n) + n) % n;
  const next = list[index]!;
  const fixedAngle = fixed.brick.part?.connections?.[fixed.index]?.angle;
  const nextAngle = next.brick.part?.connections?.[next.index]?.angle;
  if (fixedAngle === undefined || nextAngle === undefined) return null;
  // AddConnectBrick.sGetOrientationOfConnectedBrick.
  const orientation = clamp360(fixed.brick.orientation + clamp360(fixedAngle + 180 - nextAngle));
  return {
    degrees: orientation - next.brick.orientation,
    brickId: next.brick.id,
    connection: next.index,
    at: connectionWorld(old.brick, old.brick.part, old.index),
  };
}
