// Bring back bricks a layout lost while it was merged with another.
//
// While layouts were merged (see unmergeLayouts.ts) people kept editing
// them, and some of a layout's own bricks were deleted there, thinking they
// were the other layout's. The unmerge repair keeps every real edit, those
// deletions too. This puts such bricks back.
//
// Which bricks: the ones the layout's reference (a backup from before the
// merge) holds and its current doc no longer does, and that were still
// there when the merge began. The witness says that: a doc that took in
// the layout's items at the merge and didn't delete them, such as the
// other layout's doc before the repair. Without a witness every brick
// deleted since the reference comes back. A brick whose id the layout
// still has (moved to another sheet, or already restored) is left alone,
// so a second run does nothing.
//
// Yjs can't undelete: each brick is inserted again as a new item with the
// reference's data and id, next to the brick it followed in the reference,
// so the draw order holds. Links (connexions) come back where both ends
// exist: the restored brick's own, and its neighbours' that were cleared
// when it was deleted. A group a restored brick needs and the layout lost
// comes back too, and a module that listed it lists it again.
//
// The restore is one ordinary Yjs update per layout, made by a fixed client
// id, so a dry run and the real run make the same update.

import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { readSidecarCache, repairSidecarCache, writeSidecarCache } from '@cld/ydoc';

export interface RestoreInput {
  id: string;
  title: string;
  /** The layout's doc now. */
  current: Uint8Array;
  /** Its doc from before the merge (a backup). */
  reference: Uint8Array;
  /** A doc where the layout's items were alive when the merge began; null to take every deletion since the reference. */
  witness: Uint8Array | null;
}

export interface RestoredBrick {
  layerId: string;
  layerName: string;
  id: string;
  partNumber: string;
  x: number;
  y: number;
  orientation: number;
  /** Index in the layer after the restore. */
  index: number;
  /** This brick's links kept from the reference. */
  links: number;
}

export interface Skipped {
  layerId: string;
  id: string;
  partNumber: string;
  why: string;
}

export interface RestorePlan {
  id: string;
  title: string;
  restored: RestoredBrick[];
  skipped: Skipped[];
  /** Groups put back for restored bricks. */
  groups: string[];
  /** Modules that list a restored brick again. */
  modules: string[];
  /** Neighbour bricks whose links were set again. */
  relinked: number;
  update: Uint8Array;
  fingerprint: string;
}

type Conn = { id: string; linkedTo: string };
type YBrick = Y.Map<unknown>;

/** The client id the restore writes with: fixed per layout. */
export function restoreClientId(layoutId: string): number {
  const h = createHash('sha256').update(`restore-bricks:${layoutId}`).digest();
  return (h.readUInt32BE(0) & 0x3fffffff) + 1;
}

function decode(bytes: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

const itemKey = (m: { _item: Y.Item | null }) => `${m._item!.id.client}:${m._item!.id.clock}`;

function brickLayers(doc: Y.Doc): Map<string, Y.Map<unknown>> {
  const out = new Map<string, Y.Map<unknown>>();
  for (const [id, l] of doc.getMap<unknown>('layerData')) {
    if (l instanceof Y.Map && l.get('bricks') instanceof Y.Array) out.set(id, l);
  }
  return out;
}

const bricksOf = (layer: Y.Map<unknown>) => layer.get('bricks') as Y.Array<YBrick>;
const groupsOf = (layer: Y.Map<unknown>) => (layer.get('groups') instanceof Y.Array ? (layer.get('groups') as Y.Array<Y.Map<unknown>>) : null);
const connsOf = (b: YBrick) => ((b.get('connexions') as Conn[] | undefined) ?? []).map((c) => ({ id: c.id, linkedTo: c.linkedTo }));

/** A copy of a reference brick or group as a new item. */
function copyMap(src: Y.Map<unknown>): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  for (const [k, v] of src) y.set(k, v instanceof Y.AbstractType ? (v as unknown as { clone(): unknown }).clone() : structuredClone(v));
  return y;
}

export function planRestore(input: RestoreInput): RestorePlan {
  const doc = decode(input.current);
  const ref = decode(input.reference);
  const witness = input.witness ? decode(input.witness) : null;

  const liveLayers = brickLayers(doc);
  const refLayers = brickLayers(ref);
  const witnessAlive = new Set<string>();
  if (witness) for (const l of brickLayers(witness).values()) for (const b of bricksOf(l)) witnessAlive.add(itemKey(b));

  // Every brick id and connexion id the layout has now.
  const liveBrickIds = new Set<string>();
  const connOwner = new Map<string, YBrick>(); // connexion id -> live brick
  for (const l of liveLayers.values())
    for (const b of bricksOf(l)) {
      liveBrickIds.add(String(b.get('id')));
      for (const c of connsOf(b)) connOwner.set(c.id, b);
    }

  // Which reference bricks come back.
  const chosen = new Map<string, { layerId: string; refBrick: YBrick }>(); // item key -> brick
  const skipped: Skipped[] = [];
  for (const [layerId, refLayer] of refLayers) {
    const live = liveLayers.get(layerId);
    const liveKeys = new Set(live ? bricksOf(live).map(itemKey) : []);
    for (const b of bricksOf(refLayer)) {
      const key = itemKey(b);
      if (liveKeys.has(key)) continue;
      const s = { layerId, id: String(b.get('id')), partNumber: String(b.get('partNumber') ?? '') };
      if (!live) skipped.push({ ...s, why: 'its sheet is gone' });
      else if (liveBrickIds.has(s.id)) skipped.push({ ...s, why: 'the layout still has a brick with its id (moved or already restored)' });
      else if (witness && !witnessAlive.has(key)) skipped.push({ ...s, why: 'deleted before the merge' });
      else chosen.set(key, { layerId, refBrick: b });
    }
  }

  // Connexion ids the restored bricks bring.
  const restoredConns = new Set<string>();
  for (const { refBrick } of chosen.values()) for (const c of connsOf(refBrick)) restoredConns.add(c.id);
  // Live connexion id -> what it links to now.
  const liveLink = new Map<string, string>();
  for (const l of liveLayers.values()) for (const b of bricksOf(l)) for (const c of connsOf(b)) liveLink.set(c.id, c.linkedTo);
  // A restored brick's link holds when the other end is restored too, or is
  // in the layout and free (or already points back).
  const keepLink = (c: Conn) => restoredConns.has(c.linkedTo) || (liveLink.has(c.linkedTo) && ['', c.id].includes(liveLink.get(c.linkedTo)!));

  // Neighbours' links in the reference that pointed at a restored brick.
  const refLinkOf = new Map<string, string>(); // live neighbour connexion id -> restored connexion id
  for (const l of refLayers.values())
    for (const b of bricksOf(l))
      for (const c of connsOf(b)) if (c.linkedTo && restoredConns.has(c.linkedTo) && connOwner.has(c.id)) refLinkOf.set(c.id, c.linkedTo);

  const restored: RestoredBrick[] = [];
  const groups: string[] = [];
  const modules: string[] = [];
  let relinked = 0;
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.clientID = restoreClientId(input.id);
  doc.on('update', onUpdate);
  doc.transact(() => {
    const placed = new Map<string, YBrick>(); // reference item key -> brick in the layout now
    for (const [layerId, refLayer] of refLayers) {
      const live = liveLayers.get(layerId);
      if (!live) continue;
      const arr = bricksOf(live);
      const liveByKey = new Map(arr.map((b) => [itemKey(b), b] as const));
      let prev: YBrick | null = null; // the brick in the layout the next one goes after
      for (const b of bricksOf(refLayer)) {
        const key = itemKey(b);
        const here = liveByKey.get(key) ?? placed.get(key);
        if (here) {
          prev = here;
          continue;
        }
        if (!chosen.has(key)) continue;
        const copy = copyMap(b);
        const own = connsOf(b).map((c) => (c.linkedTo && !keepLink(c) ? { ...c, linkedTo: '' } : c));
        copy.set('connexions', own);
        const index = prev ? arr.toArray().indexOf(prev) + 1 : 0;
        arr.insert(index, [copy]);
        placed.set(key, copy);
        prev = copy;
        restored.push({
          layerId,
          layerName: String(live.get('name') ?? ''),
          id: String(b.get('id')),
          partNumber: String(b.get('partNumber') ?? ''),
          x: Number((b.get('displayArea') as { x?: number } | undefined)?.x ?? 0),
          y: Number((b.get('displayArea') as { y?: number } | undefined)?.y ?? 0),
          orientation: Number(b.get('orientation') ?? 0),
          index,
          links: own.filter((c) => c.linkedTo).length,
        });
      }
      // Groups the restored bricks belong to that the layer lost.
      const liveGroups = groupsOf(live);
      const refGroups = groupsOf(refLayer);
      if (refGroups) {
        const have = new Set((liveGroups?.toArray() ?? []).map((g) => String(g.get('id'))));
        const need = new Set<string>();
        for (const r of restored) if (r.layerId === layerId) {
          const g = String(chosenById(chosen, layerId, r.id)?.get('myGroup') ?? '');
          if (g) need.add(g);
        }
        // A group can sit in a group; bring back the chain.
        const refById = new Map(refGroups.toArray().map((g) => [String(g.get('id')), g] as const));
        const queue = [...need];
        while (queue.length) {
          const g = queue.pop()!;
          const parent = String(refById.get(g)?.get('myGroup') ?? '');
          if (parent && !need.has(parent)) {
            need.add(parent);
            queue.push(parent);
          }
        }
        for (const g of refGroups.toArray()) {
          const gid = String(g.get('id'));
          if (!need.has(gid) || have.has(gid)) continue;
          let target = liveGroups;
          if (!target) {
            target = new Y.Array<Y.Map<unknown>>();
            live.set('groups', target);
          }
          target.push([copyMap(g)]);
          have.add(gid);
          groups.push(`${layerId}:${gid}`);
        }
      }
    }

    // Neighbours' links cleared when the bricks went.
    const touched = new Set<YBrick>();
    for (const connId of refLinkOf.keys()) {
      const owner = connOwner.get(connId)!;
      if (touched.has(owner)) continue;
      const conns = connsOf(owner);
      let changed = 0;
      for (const c of conns) {
        const want = refLinkOf.get(c.id);
        if (want && c.linkedTo === '') {
          c.linkedTo = want;
          changed++;
        }
      }
      touched.add(owner);
      if (changed) {
        owner.set('connexions', conns);
        relinked++;
      }
    }

    // Modules that listed a restored brick list it again.
    const refCache = readSidecarCache(ref);
    const cache = readSidecarCache(doc);
    if (refCache && cache && restored.length) {
      const back = new Set(restored.map((r) => r.id));
      const refMods = new Map(((refCache.modules as { id: string; brickIds?: string[] }[] | undefined) ?? []).map((m) => [m.id, m] as const));
      let changed = false;
      const mods = ((cache.modules as { id: string; brickIds?: string[] }[] | undefined) ?? []).map((m) => {
        const add = (refMods.get(m.id)?.brickIds ?? []).filter((b) => back.has(b) && !(m.brickIds ?? []).includes(b));
        if (!add.length) return m;
        changed = true;
        modules.push(m.id);
        return { ...m, brickIds: [...(m.brickIds ?? []), ...add] };
      });
      if (changed) writeSidecarCache(doc, { ...cache, modules: mods });
    }
  }, 'restore-bricks');
  repairSidecarCache(doc, 'restore-bricks');
  doc.off('update', onUpdate);
  const update = updates.length ? Y.mergeUpdates(updates) : new Uint8Array();
  return {
    id: input.id,
    title: input.title,
    restored,
    skipped,
    groups,
    modules,
    relinked,
    update,
    fingerprint: createHash('sha256').update(update).digest('hex'),
  };
}

function chosenById(chosen: Map<string, { layerId: string; refBrick: YBrick }>, layerId: string, id: string): YBrick | undefined {
  for (const c of chosen.values()) if (c.layerId === layerId && String(c.refBrick.get('id')) === id) return c.refBrick;
  return undefined;
}

/** One fingerprint for the whole run. */
export function restoreFingerprint(plans: RestorePlan[]): string {
  const h = createHash('sha256');
  for (const p of [...plans].sort((a, b) => (a.id < b.id ? -1 : 1))) h.update(`${p.id}:${p.fingerprint}\n`);
  return h.digest('hex').slice(0, 16);
}
