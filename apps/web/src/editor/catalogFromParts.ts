// The parts catalog as the shared parts-catalog code wants it (links,
// footprints, flex moves, map formats), built from the wire parts.

import type { Catalog, PartMetadata } from '@cld/parts-catalog/browser';
import type { PartWire } from '../api';

/**
 * The catalog shape `rebuildConnectivity` reads, from the wire parts:
 * connections, pivot geometry (sprite size, hull), old names and map-format
 * remaps. Other fields are left empty since nothing reads them.
 */
export function catalogFromParts(parts: readonly PartWire[] | undefined): Catalog {
  const m: Catalog = new Map();
  for (const p of parts ?? []) {
    const meta: PartMetadata = {
      key: p.key,
      partNumber: p.partNumber,
      colorCode: p.colorCode,
      kind: p.kind,
      descriptions: {},
      author: '',
      sortingKey: p.sortingKey,
      // Custom parts have their sprite elsewhere; a leaf with no sprite
      // would read as BlueBrick's "ignorable" (sleeper plates) in maps.
      spritePath: p.spritePath || (p.source === 'custom' && p.customPartId ? `custom:${p.customPartId}` : ''),
      pxPerStud: p.pxPerStud,
      connections: p.connections.map((c) => ({
        type: c.type,
        x: c.x,
        y: c.y,
        angle: c.angle,
        electricPlug: c.electricPlug,
        // Where the active connection moves after a link (onLinked).
        ...(c.nextConnexionPreference !== undefined ? { nextConnexionPreference: c.nextConnexionPreference } : {}),
      })),
      subparts: [],
      canUngroup: true,
      hullPts: p.hullPts ?? [],
      ...(p.pickShape?.length ? { pickShape: p.pickShape } : {}),
      ...(p.spriteSize ? { spriteSize: p.spriteSize } : {}),
      ...(p.oldNames?.length ? { oldNames: p.oldNames } : {}),
      ...(p.ldraw ? { ldraw: p.ldraw } : {}),
      ...(p.trackDesigner ? { trackDesigner: p.trackDesigner } : {}),
      ...(p.fourDBrix ? { fourDBrix: p.fourDBrix } : {}),
    };
    m.set(p.key, meta);
  }
  return m;
}
