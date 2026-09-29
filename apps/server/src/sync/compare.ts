// Three-way layout compare for the desktop's reconnect window (sync phase
// P1b, DESKTOP-LIVE-SYNC.md "Offline edits and reconnecting"): the copy
// the desktop went offline with (base), its offline edits (mine) and the
// server's current layout. Every item that changed on either side is
// reported with what each side did, and whether the two clash.
//
// Items and their keys:
//   map                        header: author, LUG, event, date, comment, background
//   layer:<id>                 a layer's own properties (not its items)
//   brick:<layer>:<id>         bricks, without their connection links
//                              (links follow positions, so they'd only add noise)
//   group:<layer>:<id>
//   text:<layer>:<id|#index>   text cells (index for cells from before ids)
//   area:<layer>:<x>,<y>       area cells
//   ruler:<layer>:<hash>       rulers have no stored id, so they're keyed by
//                              content: an edited ruler is a delete plus an add
//   label:<id> module:<id> venue background   sidecar data

import { createHash } from 'node:crypto';
import type { BbmMap } from '@cld/model';
import type { Sidecar } from '@cld/bbm';

export interface LayoutSnapshot {
  map: BbmMap;
  sidecar: Sidecar | null;
}

export type SideChange = 'added' | 'edited' | 'deleted' | 'unchanged';

export interface ItemChange {
  key: string;
  kind: 'map' | 'layer' | 'brick' | 'group' | 'text' | 'area' | 'ruler' | 'label' | 'module' | 'venue' | 'background';
  layerId?: string;
  /** mine / server: only that side changed; same: both made the same change; conflict: they differ. */
  status: 'mine' | 'server' | 'same' | 'conflict';
  mine: SideChange;
  server: SideChange;
  base?: unknown;
  mineValue?: unknown;
  serverValue?: unknown;
}

/** JSON with sorted keys, so equal values compare equal. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val,
  );
}

const hash = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex').slice(0, 16);

type Items = Map<string, { kind: ItemChange['kind']; layerId?: string; value: unknown }>;

function itemsOf({ map, sidecar }: LayoutSnapshot): Items {
  const out: Items = new Map();
  const { author, lug, event, date, comment, backgroundColor } = map;
  out.set('map', { kind: 'map', value: { author, lug, event, date, comment, backgroundColor } });
  for (const layer of map.layers) {
    const lid = layer.id;
    const props: Record<string, unknown> = { ...layer };
    for (const k of ['bricks', 'groups', 'textCells', 'areas', 'rulerItems']) delete props[k];
    out.set(`layer:${lid}`, { kind: 'layer', layerId: lid, value: props });
    if ('groups' in layer) for (const g of layer.groups) out.set(`group:${lid}:${g.id}`, { kind: 'group', layerId: lid, value: g });
    switch (layer.type) {
      case 'brick':
        for (const b of layer.bricks) {
          const { connexions: _links, ...brick } = b;
          out.set(`brick:${lid}:${b.id}`, { kind: 'brick', layerId: lid, value: brick });
        }
        break;
      case 'text':
        layer.textCells.forEach((c, i) => {
          const id = (c as { id?: string }).id;
          out.set(`text:${lid}:${id ?? `#${i}`}`, { kind: 'text', layerId: lid, value: c });
        });
        break;
      case 'area':
        for (const a of layer.areas) out.set(`area:${lid}:${a.x},${a.y}`, { kind: 'area', layerId: lid, value: a.color });
        break;
      case 'ruler':
        for (const r of layer.rulerItems) {
          const { id: _id, ...ruler } = r;
          out.set(`ruler:${lid}:${hash(ruler)}`, { kind: 'ruler', layerId: lid, value: ruler });
        }
        break;
      case 'grid':
        break;
    }
  }
  for (const l of sidecar?.anchoredLabels ?? []) out.set(`label:${l.id}`, { kind: 'label', value: l });
  for (const m of sidecar?.modules ?? []) out.set(`module:${m.id}`, { kind: 'module', value: m });
  if (sidecar?.venue) out.set('venue', { kind: 'venue', value: sidecar.venue });
  if (sidecar?.backgroundImage) out.set('background', { kind: 'background', value: sidecar.backgroundImage });
  return out;
}

function sideChange(base: string | undefined, side: string | undefined): SideChange {
  if (base === side) return 'unchanged';
  if (base === undefined) return 'added';
  if (side === undefined) return 'deleted';
  return 'edited';
}

/** Every item that differs from the base on either side, in a stable order. */
export function compareLayouts(base: LayoutSnapshot, mine: LayoutSnapshot, server: LayoutSnapshot): ItemChange[] {
  const b = itemsOf(base);
  const m = itemsOf(mine);
  const s = itemsOf(server);
  const keys = [...new Set([...b.keys(), ...m.keys(), ...s.keys()])].sort();
  const out: ItemChange[] = [];
  for (const key of keys) {
    const bi = b.get(key);
    const mi = m.get(key);
    const si = s.get(key);
    const [bs, ms, ss] = [bi, mi, si].map((i) => (i ? stable(i.value) : undefined));
    const mine = sideChange(bs, ms);
    const serverChange = sideChange(bs, ss);
    if (mine === 'unchanged' && serverChange === 'unchanged') continue;
    const status: ItemChange['status'] =
      mine === 'unchanged' ? 'server' : serverChange === 'unchanged' ? 'mine' : ms === ss ? 'same' : 'conflict';
    const any = (mi ?? si ?? bi)!;
    out.push({
      key,
      kind: any.kind,
      ...(any.layerId !== undefined ? { layerId: any.layerId } : {}),
      status,
      mine,
      server: serverChange,
      ...(bi ? { base: bi.value } : {}),
      ...(mi ? { mineValue: mi.value } : {}),
      ...(si ? { serverValue: si.value } : {}),
    });
  }
  return out;
}
