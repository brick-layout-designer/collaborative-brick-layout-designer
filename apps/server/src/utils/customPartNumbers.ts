// The website places a server's custom part as "custom:<id>" (its catalog
// key, which can't collide with a bundled part). A file made for BlueBrick
// or the desktop app names it by its part number instead.
import { inArray } from 'drizzle-orm';
import type { BbmMap } from '@cld/model';
import { db, schema } from '../db/index.js';

const PREFIX = 'custom:';

function customId(partNumber: string | undefined | null): string | null {
  return partNumber && partNumber.toLowerCase().startsWith(PREFIX) ? partNumber.slice(PREFIX.length).toLowerCase() : null;
}

/** The map with every "custom:<id>" brick and group named by that part's number. Leaves `map` as it is. */
export async function withCustomPartNumbers(map: BbmMap): Promise<BbmMap> {
  const ids = new Set<string>();
  for (const layer of map.layers) {
    if (layer.type !== 'brick') continue;
    for (const b of layer.bricks) {
      const id = customId(b.partNumber);
      if (id) ids.add(id);
    }
    for (const g of layer.groups) {
      const id = customId(g.partNumber);
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) return map;
  const rows = await db
    .select({ id: schema.customParts.id, partNumber: schema.customParts.partNumber })
    .from(schema.customParts)
    .where(inArray(schema.customParts.id, [...ids]))
    .all();
  const numbers = new Map(rows.map((r) => [r.id.toLowerCase(), r.partNumber]));
  const named = (p: string) => {
    const id = customId(p);
    return (id && numbers.get(id)) || p;
  };
  return {
    ...map,
    layers: map.layers.map((layer) =>
      layer.type !== 'brick'
        ? layer
        : {
            ...layer,
            bricks: layer.bricks.map((b) => (customId(b.partNumber) ? { ...b, partNumber: named(b.partNumber) } : b)),
            groups: layer.groups.map((g) => (g.partNumber && customId(g.partNumber) ? { ...g, partNumber: named(g.partNumber) } : g)),
          },
    ),
  };
}
