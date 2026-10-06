// A placed module and its copy in the library, both ways.
//
// Make a module: the picked parts become a module in this layout only.
// Save to library…: a copy goes to your modules or a club's, and the placed
// module is linked to it (`libraryModuleId`, `libraryVersion` in the
// sidecar; BlueBrick never sees them). Modules added from the library are
// linked the same way. A linked module can then:
//   - Update library version: its parts in this layout become the
//     library's next version, with a "What changed?" note;
//   - Update from library: a newer library version replaces its parts,
//     where the module sits now, each part on its sheet. It asks first when
//     the module was changed in this layout.
// The desktop does the same (edit/ModuleLibraryLink.cpp).

import * as Y from 'yjs';
import type { BbmMap, Brick } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { docToBbm, encodeDoc, readSidecarFromDoc, seedFromBbm } from '@cld/ydoc';
import { api, type ModuleSummary, type PartWire } from '../api';
import { askConfirm } from '../ui/ConfirmDialog';
import { pivotOf } from './brickGeometry';
import { moduleBatchesFromMap, placedModuleBatches } from './moduleDrop';
import { findPartsSheet, moduleMapFromSelection, moduleSheetsUsed, pickedPartsSheet } from './moduleSheets';
import { patchSidecarModule, replaceModuleParts, type ModuleBatch } from './mutations';
import { lookupPart } from './snap';
import { projectDoc } from './useDocMap';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The library module a placed module is linked to; `version` null when not known. */
export interface LibraryLink {
  id: string;
  version: number | null;
}

/**
 * The placed module's link to the library. Older builds kept the library
 * id (web) or the module's page on the server (desktop) in `sourceFile`;
 * those count as linked, at an unknown version.
 */
export function libraryLink(m: Pick<SidecarModule, 'libraryModuleId' | 'libraryVersion' | 'sourceFile'>): LibraryLink | null {
  const version = typeof m.libraryVersion === 'number' && m.libraryVersion > 0 ? m.libraryVersion : null;
  if (typeof m.libraryModuleId === 'string' && UUID_RE.test(m.libraryModuleId)) return { id: m.libraryModuleId, version };
  const src = typeof m.sourceFile === 'string' ? m.sourceFile : '';
  const legacy = UUID_RE.test(src) ? src : /\/modules\/([0-9a-f-]{36})\/?$/.exec(src)?.[1];
  return legacy && UUID_RE.test(legacy) ? { id: legacy, version: null } : null;
}

/** What the module's menus offer about its library copy. */
export type LibraryState =
  | { kind: 'unlinked' }
  /** Linked, but the library module isn't one you can see (deleted, or not shared with you). */
  | { kind: 'missing'; id: string }
  | {
      kind: 'linked';
      id: string;
      title: string;
      /** The version this layout's copy matches; null when not known. */
      version: number | null;
      /** The library's newest version (0: none yet). */
      latest: number;
      /** You may save new versions of it (its owner, or an editor). */
      canPublish: boolean;
      /** The library has a version this layout's copy doesn't. */
      newer: boolean;
    };

/** The module's library state, from your modules list (`api.modules.list`). */
export function libraryState(
  m: Pick<SidecarModule, 'libraryModuleId' | 'libraryVersion' | 'sourceFile'>,
  library: readonly ModuleSummary[] | undefined,
): LibraryState {
  const link = libraryLink(m);
  if (!link) return { kind: 'unlinked' };
  const found = library?.find((x) => x.id === link.id);
  if (!found) return { kind: 'missing', id: link.id };
  const latest = found.latestVersion ?? 0;
  return {
    kind: 'linked',
    id: link.id,
    title: found.title,
    version: link.version,
    latest,
    canPublish: found.role === undefined || found.role === 'owner' || found.role === 'editor',
    newer: latest > 0 && (link.version === null || latest > link.version),
  };
}

/** The line the Modules panel shows under a linked module. */
export function libraryNote(state: LibraryState): string | null {
  if (state.kind === 'unlinked') return null;
  if (state.kind === 'missing') return 'its library copy is gone';
  const v = state.version ? ` v${state.version}` : '';
  return state.newer ? `in the library${v} · v${state.latest} is newer` : `in the library${v}`;
}

// ---- Saving ---------------------------------------------------------------

type Thumb = { mime: 'image/png' | 'image/webp'; data: string };
export type MakeThumbnail = (region: { x: number; y: number; width: number; height: number }) => Promise<Thumb | null>;

/** A module's parts as a library module's contents (centred, sheets kept or one sheet). */
export function moduleContents(
  map: BbmMap,
  members: readonly string[],
  oneSheet = false,
): { bytes: Uint8Array; region: { x: number; y: number; width: number; height: number }; count: number } | null {
  const built = moduleMapFromSelection(map, members, { oneSheet });
  if (!built) return null;
  const d = seedFromBbm(built.moduleMap);
  const bytes = encodeDoc(d);
  d.destroy();
  return { bytes, region: built.region, count: built.count };
}

function findModule(doc: Y.Doc, moduleId: string): SidecarModule {
  const m = readSidecarFromDoc(doc)?.modules?.find((x) => x.id === moduleId);
  if (!m) throw new Error('That module is no longer in this layout.');
  return m;
}

async function versionOf(id: string, saved: { version?: number }): Promise<number | undefined> {
  if (saved.version) return saved.version;
  try {
    return (await api.modules.get(id)).module.latestVersion || undefined;
  } catch {
    return undefined;
  }
}

async function picture(id: string, region: { x: number; y: number; width: number; height: number }, makeThumbnail?: MakeThumbnail) {
  try {
    const thumb = await makeThumbnail?.(region);
    if (thumb) await api.modules.setThumbnail(id, thumb);
  } catch {
    // No picture: the lists show a placeholder until the module is opened.
  }
}

export interface SaveToLibraryOptions {
  /** A new library module's name. */
  title: string;
  /** Its owner: a club's slug, or '' for you. */
  ownerSlug: string;
  /** "What changed?" */
  note?: string;
  /** Put everything on one sheet. */
  oneSheet?: boolean;
  /** Save as a new version of this library module instead of a new one. */
  updateId?: string;
  makeThumbnail?: MakeThumbnail | undefined;
}

/**
 * Save to library…: the placed module's parts go to the library (a new
 * module, or a new version of one you can change), and the placed module
 * is linked to it. Returns the library module and its version.
 */
export async function saveModuleToLibrary(
  doc: Y.Doc,
  moduleId: string,
  o: SaveToLibraryOptions,
): Promise<{ id: string; title: string; version: number | undefined }> {
  const mod = findModule(doc, moduleId);
  const map = projectDoc(doc);
  const contents = map ? moduleContents(map, mod.members, o.oneSheet) : null;
  if (!contents) throw new Error('This module has no parts to save.');
  let id: string;
  let title: string;
  let version: number | undefined;
  if (o.updateId) {
    id = o.updateId;
    title = o.title;
    version = await versionOf(id, await api.modules.saveSnapshot(id, contents.bytes, o.note));
  } else {
    const created = await api.modules.create(o.ownerSlug ? { title: o.title, orgSlug: o.ownerSlug } : { title: o.title });
    id = created.id;
    title = created.title;
    try {
      version = await versionOf(id, await api.modules.saveSnapshot(id, contents.bytes, o.note));
    } catch (e) {
      // Don't leave an empty module behind when its contents didn't arrive.
      await api.modules.remove(id).catch(() => undefined);
      throw e;
    }
  }
  await picture(id, contents.region, o.makeThumbnail);
  patchSidecarModule(doc, moduleId, { libraryModuleId: id, ...(version ? { libraryVersion: version } : {}) });
  return { id, title, version };
}

/** Update library version: the placed module's parts become the library's next version. */
export async function publishModuleVersion(
  doc: Y.Doc,
  moduleId: string,
  o: { note?: string; oneSheet?: boolean; makeThumbnail?: MakeThumbnail | undefined },
): Promise<{ id: string; version: number | undefined }> {
  const mod = findModule(doc, moduleId);
  const link = libraryLink(mod);
  if (!link) throw new Error('Save this module to the library first.');
  const map = projectDoc(doc);
  const contents = map ? moduleContents(map, mod.members, o.oneSheet) : null;
  if (!contents) throw new Error('This module has no parts to save.');
  const version = await versionOf(link.id, await api.modules.saveSnapshot(link.id, contents.bytes, o.note));
  await picture(link.id, contents.region, o.makeThumbnail);
  patchSidecarModule(doc, moduleId, { libraryModuleId: link.id, ...(version ? { libraryVersion: version } : {}) });
  return { id: link.id, version };
}

// ---- Reading a library version ---------------------------------------------

/** A library module's contents as insert batches (one per sheet). */
export function batchesFromBytes(bytes: Uint8Array): ModuleBatch[] {
  const d = new Y.Doc();
  try {
    Y.applyUpdate(d, bytes);
    return moduleBatchesFromMap(docToBbm(d));
  } catch (e) {
    throw new Error('The library module couldn’t be read.', { cause: e });
  } finally {
    d.destroy();
  }
}

/** The library's newest version of a module (`version` absent), or one version. */
export async function fetchLibraryVersion(id: string, version?: number): Promise<{ batches: ModuleBatch[]; version: number }> {
  if (!UUID_RE.test(id)) throw new Error('invalid module id');
  if (version) return { batches: batchesFromBytes(await api.modules.versionSnapshot(id, version)), version };
  // The number first: a version saved in between makes this one look older, never newer.
  const latest = (await api.modules.get(id)).module.latestVersion ?? 0;
  return { batches: batchesFromBytes(await api.modules.snapshot(id)), version: latest };
}

// ---- Where a library version goes on the map --------------------------------

type Pt = { x: number; y: number };

/** How a library version sits in the layout: turned by `degrees` about its origin, then moved to (`toX`, `toY`). */
export interface Placement {
  degrees: number;
  toX: number;
  toY: number;
  /** How many parts agree with it (0: a guess from the module's middle). */
  matched: number;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const bucket = (v: number, step: number) => Math.round(v / step) * step;
/** At most this many part pairs are compared per part number (big modules stay quick). */
const MAX_PAIRS = 40000;

function pivot(b: { partNumber: string; displayArea: Brick['displayArea']; orientation?: number }, parts: Map<string, PartWire> | null): Pt {
  const meta = parts ? lookupPart(parts, b.partNumber) : undefined;
  return pivotOf({ displayArea: b.displayArea, orientation: b.orientation ?? 0 }, meta);
}

type Item = { key: string; p: Pt; o: number };

function items(bricks: readonly { partNumber: string; displayArea: Brick['displayArea']; orientation?: number }[], parts: Map<string, PartWire> | null): Item[] {
  return bricks.map((b) => ({ key: b.partNumber.toLowerCase(), p: pivot(b, parts), o: norm360(b.orientation ?? 0) }));
}

/** Each part number's pairs (library part, placed part), thinned evenly past MAX_PAIRS. */
function* pairs(lib: readonly Item[], placed: readonly Item[]): Generator<[Item, Item]> {
  const byKey = new Map<string, Item[]>();
  for (const it of placed) {
    const list = byKey.get(it.key);
    if (list) list.push(it);
    else byKey.set(it.key, [it]);
  }
  const libByKey = new Map<string, Item[]>();
  for (const it of lib) {
    const list = libByKey.get(it.key);
    if (list) list.push(it);
    else libByKey.set(it.key, [it]);
  }
  for (const [key, a] of libByKey) {
    const b = byKey.get(key);
    if (!b) continue;
    const stride = Math.max(1, Math.ceil((a.length * b.length) / MAX_PAIRS));
    let n = 0;
    for (const x of a) for (const y of b) if (n++ % stride === 0) yield [x, y];
  }
}

/** The most common value (the smallest on a tie, so the answer never depends on order). */
function mode<T>(counts: Map<string, { n: number; v: T }>, smaller: (a: T, b: T) => boolean): { v: T; n: number } | null {
  let best: { v: T; n: number } | null = null;
  for (const { n, v } of counts.values()) if (!best || n > best.n || (n === best.n && smaller(v, best.v))) best = { v, n };
  return best;
}

/**
 * Where a library version's parts go so that its parts the layout already
 * has land on them: the turn most part pairs agree on, then the shift.
 * Robust to some parts having changed on either side. Falls back to the
 * placed module's middle, unturned, when no parts are alike.
 */
export function alignToPlaced(
  batches: readonly ModuleBatch[],
  placed: readonly Brick[],
  parts: Map<string, PartWire> | null,
): Placement {
  const lib = items(batches.flatMap((b) => b.bricks), parts);
  const here = items(placed, parts);
  const turns = new Map<string, { n: number; v: number }>();
  for (const [a, b] of pairs(lib, here)) {
    const d = bucket(norm360(b.o - a.o), 0.1) % 360;
    const k = d.toFixed(1);
    const e = turns.get(k);
    if (e) e.n++;
    else turns.set(k, { n: 1, v: d });
  }
  const turn = mode(turns, (x, y) => x < y);
  if (turn) {
    const r = (turn.v * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const shifts = new Map<string, { n: number; v: Pt }>();
    for (const [a, b] of pairs(lib, here)) {
      const d = norm360(b.o - a.o);
      if (Math.min(Math.abs(d - turn.v), 360 - Math.abs(d - turn.v)) > 0.1) continue;
      const v = { x: bucket(b.p.x - (a.p.x * c - a.p.y * s), 0.05), y: bucket(b.p.y - (a.p.x * s + a.p.y * c), 0.05) };
      const k = `${v.x.toFixed(2)},${v.y.toFixed(2)}`;
      const e = shifts.get(k);
      if (e) e.n++;
      else shifts.set(k, { n: 1, v });
    }
    const shift = mode(shifts, (x, y) => x.x < y.x || (x.x === y.x && x.y < y.y));
    if (shift) return { degrees: turn.v, toX: shift.v.x, toY: shift.v.y, matched: shift.n };
  }
  // Nothing alike: the library version's middle on the module's middle.
  const mid = (xs: readonly Item[]) =>
    xs.length === 0 ? { x: 0, y: 0 } : { x: xs.reduce((n, i) => n + i.p.x, 0) / xs.length, y: xs.reduce((n, i) => n + i.p.y, 0) / xs.length };
  const a = mid(lib);
  const b = mid(here);
  return { degrees: 0, toX: b.x - a.x, toY: b.y - a.y, matched: 0 };
}

/** The library version's parts where `placement` puts them. */
export function placeVersion(batches: readonly ModuleBatch[], placement: Placement, parts: Map<string, PartWire> | null): ModuleBatch[] {
  return placedModuleBatches([...batches], {
    dx: 0,
    dy: 0,
    turn: { degrees: placement.degrees, pivotX: 0, pivotY: 0, toX: placement.toX, toY: placement.toY },
  }, parts);
}

/**
 * Whether the placed module's parts are exactly the library version's
 * (same parts, same places and turns, within a hair): false when it was
 * changed in this layout.
 */
export function matchesVersion(batches: readonly ModuleBatch[], placed: readonly Brick[], parts: Map<string, PartWire> | null): boolean {
  const lib = items(placeVersion(batches, alignToPlaced(batches, placed, parts), parts).flatMap((b) => b.bricks), parts);
  const here = items(placed, parts);
  if (lib.length !== here.length) return false;
  const used = new Set<number>();
  for (const h of here) {
    const i = lib.findIndex(
      (l, k) =>
        !used.has(k) &&
        l.key === h.key &&
        Math.hypot(l.p.x - h.p.x, l.p.y - h.p.y) < 0.1 &&
        Math.min(Math.abs(l.o - h.o), 360 - Math.abs(l.o - h.o)) < 0.5,
    );
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}

/** The module's parts, on every sheet. */
export function placedParts(map: BbmMap, members: readonly string[]): Brick[] {
  const set = new Set(members);
  const out: Brick[] = [];
  for (const l of map.layers) if (l.type === 'brick') for (const b of l.bricks) if (set.has(b.id)) out.push(b);
  return out;
}

/**
 * Which sheet a library sheet's parts go on when the module is updated:
 * the layout's sheet with the same name, else the sheet most of the
 * module's parts are on now, else the picked sheet.
 */
export function sheetForUpdate(map: BbmMap, members: readonly string[], activeLayerId: string | null): (name: string) => string {
  const most = [...moduleSheetsUsed(map, members)].sort((a, b) => b.parts - a.parts)[0]?.id ?? null;
  const fallback = most ?? pickedPartsSheet(map, activeLayerId) ?? map.layers.find((l) => l.type === 'brick')?.id ?? '';
  return (name) => findPartsSheet(map.layers, name) ?? fallback;
}

export type PullResult = 'updated' | 'up-to-date' | 'cancelled';

/**
 * Update from library: the library's newest version replaces the module's
 * parts, where the module sits now, each on its sheet (one undo step). When
 * the module was changed in this layout (or that can't be told), `confirm`
 * asks first.
 */
export async function pullFromLibrary(
  doc: Y.Doc,
  moduleId: string,
  o: {
    parts: Map<string, PartWire> | null;
    activeLayerId: string | null;
    confirm?: (opts: Parameters<typeof askConfirm>[0]) => Promise<boolean>;
  },
): Promise<PullResult> {
  const mod = findModule(doc, moduleId);
  const link = libraryLink(mod);
  if (!link) throw new Error('This module isn’t in the library yet.');
  const latest = await fetchLibraryVersion(link.id);
  if (link.version !== null && latest.version <= link.version) return 'up-to-date';
  const map = projectDoc(doc);
  if (!map) throw new Error('The layout isn’t ready yet.');
  const placed = placedParts(map, mod.members);
  // Changed in this layout? Compare with the version it was linked at.
  let changed = true;
  if (link.version !== null) {
    try {
      changed = !matchesVersion((await fetchLibraryVersion(link.id, link.version)).batches, placed, o.parts);
    } catch {
      changed = true;
    }
  }
  if (changed) {
    const ok = await (o.confirm ?? askConfirm)({
      title: `Replace “${mod.name || 'this module'}” with version ${latest.version}?`,
      removes: 'This module was changed in this layout. Those changes are replaced by the library’s version.',
      keeps: 'Its name, colours and place on the map stay. You can undo this.',
      confirmLabel: 'Update',
      danger: false,
    });
    if (!ok) return 'cancelled';
  }
  const placement = alignToPlaced(latest.batches, placed, o.parts);
  const batches = placeVersion(latest.batches, placement, o.parts);
  // The map may have changed while the library answered.
  const now = projectDoc(doc) ?? map;
  const current = findModule(doc, moduleId);
  replaceModuleParts(doc, moduleId, batches, sheetForUpdate(now, current.members, o.activeLayerId), {
    libraryModuleId: link.id,
    ...(latest.version ? { libraryVersion: latest.version } : {}),
  });
  return 'updated';
}
