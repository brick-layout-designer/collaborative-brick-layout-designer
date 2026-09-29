// What the map-format readers and writers need from the parts library —
// port of the desktop PartsLibrary lookups they use and of
// parts/BrickPlacement.h. Positions are in studs; a brick's pivot is its
// sprite centre (displayArea centre + imageOffset).

import type { BbmMap, Brick, LayerBrick, LayerGrid } from '@cld/model';
import { BBM_FORMAT_VERSION } from '@cld/model';
import { makeCatalogLookup } from '../connectivity.js';
import { footprint, type Footprint } from '../footprint.js';
import type { Catalog, PartMetadata } from '../types.js';

export interface MapReadResult {
  map: BbmMap;
  /** Things the reader skipped or couldn't map, for the user. */
  warnings: string[];
}

type Point = { x: number; y: number };

/** A random 63-bit decimal id, as vanilla BlueBrick ids must parse as ulong. */
export function makeId(): string {
  const a = new BigUint64Array(1);
  crypto.getRandomValues(a);
  const v = a[0]! >> 1n;
  return (v === 0n ? 1n : v).toString();
}

export function rotated(v: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** The part number a brick stores for a library part: `PART.COLOUR`, upper case. */
export function partNumberOf(meta: PartMetadata): string {
  return (meta.colorCode ? `${meta.partNumber}.${meta.colorCode}` : meta.partNumber).toUpperCase();
}

export class MapLibrary {
  readonly catalog: Catalog;
  private readonly lookup: (partNumber: string) => PartMetadata | undefined;
  private fourDBrixNames?: Map<string, PartMetadata>;
  private trackDesignerIds?: Map<number, PartMetadata[]>;

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    this.lookup = makeCatalogLookup(catalog);
  }

  meta(partNumber: string): PartMetadata | undefined {
    return this.lookup(partNumber);
  }

  footprint(partNumber: string, orientation: number): Footprint | null {
    const meta = this.meta(partNumber);
    return meta ? footprint(meta, orientation) : null;
  }

  imageOffset(partNumber: string, orientation: number): Point {
    const meta = this.meta(partNumber);
    if (!meta?.hullPts.length) return { x: 0, y: 0 };
    return this.footprint(partNumber, orientation)?.imageOffset ?? { x: 0, y: 0 };
  }

  /** The part mapped to a 4DBrix name; the smallest key wins, as in BlueBrick. */
  partForFourDBrixName(name: string): PartMetadata | undefined {
    if (!this.fourDBrixNames) {
      this.fourDBrixNames = new Map();
      for (const meta of this.catalog.values()) {
        const n = meta.fourDBrix?.partName;
        if (!n) continue;
        const owner = this.fourDBrixNames.get(n);
        if (!owner || meta.key < owner.key) this.fourDBrixNames.set(n, meta);
      }
    }
    return this.fourDBrixNames.get(name);
  }

  /** Parts with this TrackDesigner id (default or any registry), by key. */
  partsForTrackDesignerId(id: number): PartMetadata[] {
    if (!this.trackDesignerIds) {
      this.trackDesignerIds = new Map();
      for (const meta of [...this.catalog.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
        const td = meta.trackDesigner;
        if (!td) continue;
        for (const i of new Set([td.defaultId, ...Object.values(td.registryIds)])) {
          if (i === 0) continue;
          const list = this.trackDesignerIds.get(i) ?? [];
          list.push(meta);
          this.trackDesignerIds.set(i, list);
        }
      }
    }
    return this.trackDesignerIds.get(id) ?? [];
  }

  imageCentre(b: Brick): Point {
    const off = this.imageOffset(b.partNumber, b.orientation);
    return { x: b.displayArea.x + b.displayArea.width / 2 + off.x, y: b.displayArea.y + b.displayArea.height / 2 + off.y };
  }

  connectionWorld(b: Brick, index: number): Point {
    const meta = this.meta(b.partNumber);
    const c = this.imageCentre(b);
    const cp = meta?.connections[index];
    if (!cp) return c;
    const r = rotated({ x: cp.x, y: cp.y }, b.orientation);
    return { x: c.x + r.x, y: c.y + r.y };
  }

  /** displayArea size for the brick's orientation; unknown parts keep theirs, or 2x2. */
  areaSize(b: Brick): { w: number; h: number } {
    const fp = this.footprint(b.partNumber, b.orientation);
    if (fp) return fp.size;
    const { width, height } = b.displayArea;
    return width > 0 && height > 0 ? { w: width, h: height } : { w: 2, h: 2 };
  }

  placeByAreaCentre(b: Brick, centre: Point): void {
    const s = this.areaSize(b);
    b.displayArea = { x: centre.x - s.w / 2, y: centre.y - s.h / 2, width: s.w, height: s.h };
  }

  placeByImageCentre(b: Brick, centre: Point): void {
    const off = this.imageOffset(b.partNumber, b.orientation);
    this.placeByAreaCentre(b, { x: centre.x - off.x, y: centre.y - off.y });
  }

  /** Places the brick so its connection `index` sits at `world`. */
  placeByConnection(b: Brick, index: number, world: Point): void {
    const cp = this.meta(b.partNumber)?.connections[index];
    const r = cp ? rotated({ x: cp.x, y: cp.y }, b.orientation) : { x: 0, y: 0 };
    this.placeByImageCentre(b, { x: world.x - r.x, y: world.y - r.y });
  }

  /** A brick of `meta` with one free connexion per connection point. */
  newBrick(meta: PartMetadata): Brick {
    return {
      id: makeId(),
      displayArea: { x: 0, y: 0, width: 0, height: 0 },
      myGroup: '',
      partNumber: partNumberOf(meta),
      orientation: 0,
      activeConnectionPointIndex: 0,
      altitude: 0,
      connexions: meta.connections.map(() => ({ id: makeId(), linkedTo: '' })),
    };
  }
}

/** A new map with desktop Map defaults and no layers. */
export function newMap(now = new Date()): BbmMap {
  return {
    version: BBM_FORMAT_VERSION,
    nbItems: 0,
    backgroundColor: { kind: 'known', name: 'White' },
    author: '',
    lug: '',
    event: '',
    date: { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() },
    comment: '',
    exportInfo: {
      exportPath: '',
      exportFileType: 1,
      exportArea: { x: 0, y: 0, width: 0, height: 0 },
      exportScale: 0,
      exportWatermark: false,
      exportElectricCircuit: false,
      exportConnectionPoints: false,
    },
    selectedLayerIndex: -1,
    layers: [],
  };
}

const HULL = { isVisible: false, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 } as const;

/** A grid layer with desktop LayerGrid defaults. */
export function newGridLayer(name = 'Grid'): LayerGrid {
  return {
    type: 'grid',
    id: makeId(),
    name,
    visible: true,
    transparency: 100,
    hullProperties: { ...HULL },
    gridColor: { kind: 'argb', argb: '80000000' },
    gridThickness: 2,
    subGridColor: { kind: 'argb', argb: '40000000' },
    subGridThickness: 1,
    gridSizeInStud: 32,
    subDivisionNumber: 4,
    displayGrid: true,
    displaySubGrid: true,
    displayCellIndex: false,
    cellIndexFont: { family: 'Microsoft Sans Serif', size: 8.25, style: 'Regular' },
    cellIndexColor: { kind: 'known', name: 'Black' },
    cellIndexColumnType: '0',
    cellIndexRowType: '1',
    cellIndexCorner: { x: 0, y: 0 },
  };
}

export function newBrickLayer(name: string, bricks: Brick[] = []): LayerBrick {
  return {
    type: 'brick',
    id: makeId(),
    name,
    visible: true,
    transparency: 100,
    hullProperties: { ...HULL },
    displayBrickElevation: false,
    bricks,
    groups: [],
  };
}
