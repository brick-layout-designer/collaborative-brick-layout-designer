// Yjs ↔ BbmMap projection.
//
// The Yjs document is the canonical in-memory shape during editing; the
// BbmMap is the import/export shape. Round-trip parity between the two is
// enforced by the property tests in projection.test.ts.
//
// Doc shape (sketched in PLAN.md §3.2, materialised here):
//
//   doc.getMap('meta')          → version, nbItems, BackgroundColor, author,
//                                 lug, event, date, comment, exportInfo,
//                                 selectedLayerIndex
//   doc.getArray('layers')      → ordered list of layer ids (string)
//   doc.getMap('layerData')     → layerId → Y.Map of layer fields. Every
//                                 layer kind keeps its scalar fields directly
//                                 in the Y.Map. Child collections (bricks,
//                                 textCells, areas, groups) are nested
//                                 Y.Arrays of Y.Maps so per-item edits are
//                                 small Yjs updates rather than full-layer
//                                 rewrites.
//
// Two design choices worth highlighting:
//
//  - We persist BBM-specific structures (RectangleF, ColorSpec, FontSpec) as
//    plain JSON-serialisable objects inside Y.Maps, NOT as nested Y.Maps.
//    These values are mutated atomically — a brick's displayArea is always
//    replaced wholesale, never edited field-by-field — so the extra
//    granularity buys nothing and adds Yjs node overhead.
//
//  - The doc preserves layer/brick order (Y.Array). Per-id maps would let
//    us look up an item in O(1) but lose the iteration order that BBM
//    cares about.

import * as Y from 'yjs';
import type {
  AreaCell,
  BbmMap,
  Brick,
  ColorSpec,
  Connexion,
  ExportInfo,
  FontSpec,
  Group,
  HullProperties,
  Layer,
  LayerArea,
  LayerBrick,
  LayerGrid,
  LayerRuler,
  LayerText,
  RectangleF,
  TextCell,
} from '@cld/model';

// ---------------------------------------------------------------------------
// Top-level projection
// ---------------------------------------------------------------------------

/**
 * Apply a `BbmMap` into a fresh `Y.Doc`. The doc is left in a clean state
 * (no transactions, no history) — callers that want to seed an UndoManager
 * should do so AFTER this returns.
 */
export function bbmToDoc(map: BbmMap, doc: Y.Doc): void {
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('version', map.version);
    meta.set('nbItems', map.nbItems);
    meta.set('backgroundColor', map.backgroundColor);
    meta.set('author', map.author);
    meta.set('lug', map.lug);
    meta.set('event', map.event);
    meta.set('date', { ...map.date });
    meta.set('comment', map.comment);
    meta.set('exportInfo', cloneExportInfo(map.exportInfo));
    meta.set('selectedLayerIndex', map.selectedLayerIndex);

    const layerOrder = doc.getArray<string>('layers');
    const layerData = doc.getMap<Y.Map<unknown>>('layerData');

    // Clear any prior state — bbmToDoc replaces, not merges.
    layerOrder.delete(0, layerOrder.length);
    for (const k of [...layerData.keys()]) layerData.delete(k);

    for (const layer of map.layers) {
      const yLayer = new Y.Map<unknown>();
      writeLayer(layer, yLayer);
      layerData.set(layer.id, yLayer);
      layerOrder.push([layer.id]);
    }
  });
}

/** Reconstruct a `BbmMap` from a populated `Y.Doc`. */
export function docToBbm(doc: Y.Doc): BbmMap {
  const meta = doc.getMap('meta');
  const layerOrder = doc.getArray<string>('layers');
  const layerData = doc.getMap<Y.Map<unknown>>('layerData');

  const layers: Layer[] = [];
  for (const id of layerOrder.toArray()) {
    const yLayer = layerData.get(id);
    if (!yLayer) continue;
    layers.push(readLayer(id, yLayer));
  }

  return {
    version: requireScalar(meta, 'version') as number,
    nbItems: requireScalar(meta, 'nbItems') as number,
    backgroundColor: requireScalar(meta, 'backgroundColor') as ColorSpec,
    author: requireScalar(meta, 'author') as string,
    lug: requireScalar(meta, 'lug') as string,
    event: requireScalar(meta, 'event') as string,
    date: { ...(requireScalar(meta, 'date') as BbmMap['date']) },
    comment: requireScalar(meta, 'comment') as string,
    exportInfo: cloneExportInfo(requireScalar(meta, 'exportInfo') as ExportInfo),
    selectedLayerIndex: requireScalar(meta, 'selectedLayerIndex') as number,
    layers,
  };
}

// ---------------------------------------------------------------------------
// Layer write
// ---------------------------------------------------------------------------

function writeLayer(layer: Layer, y: Y.Map<unknown>): void {
  // Common fields on every layer kind. `id` is implicit (it's the key in
  // layerData), but stash it inside the Y.Map too so reads don't need a
  // back-reference.
  y.set('id', layer.id);
  y.set('type', layer.type);
  y.set('name', layer.name);
  y.set('visible', layer.visible);
  y.set('transparency', layer.transparency);
  y.set('hullProperties', cloneHull(layer.hullProperties));

  switch (layer.type) {
    case 'grid':
      writeLayerGrid(layer, y);
      break;
    case 'brick':
      writeLayerBrick(layer, y);
      break;
    case 'text':
      writeLayerText(layer, y);
      break;
    case 'area':
      writeLayerArea(layer, y);
      break;
    case 'ruler':
      writeLayerRuler(layer, y);
      break;
  }
}

function writeLayerGrid(layer: LayerGrid, y: Y.Map<unknown>): void {
  y.set('gridColor', layer.gridColor);
  y.set('gridThickness', layer.gridThickness);
  y.set('subGridColor', layer.subGridColor);
  y.set('subGridThickness', layer.subGridThickness);
  y.set('gridSizeInStud', layer.gridSizeInStud);
  y.set('subDivisionNumber', layer.subDivisionNumber);
  y.set('displayGrid', layer.displayGrid);
  y.set('displaySubGrid', layer.displaySubGrid);
  y.set('displayCellIndex', layer.displayCellIndex);
  y.set('cellIndexFont', { ...layer.cellIndexFont });
  y.set('cellIndexColor', layer.cellIndexColor);
  y.set('cellIndexColumnType', layer.cellIndexColumnType);
  y.set('cellIndexRowType', layer.cellIndexRowType);
  y.set('cellIndexCorner', layer.cellIndexCorner);
}

function writeLayerBrick(layer: LayerBrick, y: Y.Map<unknown>): void {
  y.set('displayBrickElevation', layer.displayBrickElevation);
  const bricks = new Y.Array<Y.Map<unknown>>();
  for (const b of layer.bricks) bricks.push([brickToYMap(b)]);
  y.set('bricks', bricks);
  const groups = new Y.Array<Y.Map<unknown>>();
  for (const g of layer.groups) groups.push([groupToYMap(g)]);
  y.set('groups', groups);
}

function brickToYMap(brick: Brick): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  y.set('id', brick.id);
  y.set('displayArea', cloneRect(brick.displayArea));
  y.set('myGroup', brick.myGroup);
  y.set('partNumber', brick.partNumber);
  y.set('orientation', brick.orientation);
  y.set('activeConnectionPointIndex', brick.activeConnectionPointIndex);
  y.set('altitude', brick.altitude);
  y.set(
    'connexions',
    brick.connexions.map((c) => ({ id: c.id, linkedTo: c.linkedTo })),
  );
  return y;
}

function groupToYMap(group: Group): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  y.set('id', group.id);
  if (group.partNumber !== undefined) y.set('partNumber', group.partNumber);
  if (group.orientation !== undefined) y.set('orientation', group.orientation);
  if (group.altitude !== undefined) y.set('altitude', group.altitude);
  if (group.myGroup !== undefined) y.set('myGroup', group.myGroup);
  return y;
}

function writeLayerText(layer: LayerText, y: Y.Map<unknown>): void {
  const cells = new Y.Array<Y.Map<unknown>>();
  for (const t of layer.textCells) cells.push([textCellToYMap(t)]);
  y.set('textCells', cells);
  const groups = new Y.Array<Y.Map<unknown>>();
  for (const g of layer.groups) groups.push([groupToYMap(g)]);
  y.set('groups', groups);
}

function textCellToYMap(t: TextCell): Y.Map<unknown> {
  const y = new Y.Map<unknown>();
  y.set('displayArea', cloneRect(t.displayArea));
  y.set('myGroup', t.myGroup);
  y.set('text', t.text);
  y.set('orientation', t.orientation);
  y.set('fontColor', t.fontColor);
  y.set('font', { ...t.font });
  y.set('textAlignment', t.textAlignment);
  return y;
}

function writeLayerArea(layer: LayerArea, y: Y.Map<unknown>): void {
  y.set('areaCellSize', layer.areaCellSize);
  const areas = new Y.Array<AreaCell>();
  for (const a of layer.areas) areas.push([{ ...a }]);
  y.set('areas', areas);
}

function writeLayerRuler(layer: LayerRuler, y: Y.Map<unknown>): void {
  // Ruler items not yet ported — see packages/bbm Writer notes. We persist
  // an empty Y.Array so the doc shape is stable when ruler support lands.
  y.set('rulerItems', new Y.Array<Y.Map<unknown>>());
  const groups = new Y.Array<Y.Map<unknown>>();
  for (const g of layer.groups) groups.push([groupToYMap(g)]);
  y.set('groups', groups);
}

// ---------------------------------------------------------------------------
// Layer read
// ---------------------------------------------------------------------------

function readLayer(id: string, y: Y.Map<unknown>): Layer {
  const type = requireScalar(y, 'type') as Layer['type'];
  const common = {
    id,
    name: requireScalar(y, 'name') as string,
    visible: requireScalar(y, 'visible') as boolean,
    transparency: requireScalar(y, 'transparency') as number,
    hullProperties: cloneHull(requireScalar(y, 'hullProperties') as HullProperties),
  };

  switch (type) {
    case 'grid':
      return readLayerGrid(y, common);
    case 'brick':
      return readLayerBrick(y, common);
    case 'text':
      return readLayerText(y, common);
    case 'area':
      return readLayerArea(y, common);
    case 'ruler':
      return readLayerRuler(y, common);
  }
}

type CommonFields = Pick<LayerGrid, 'id' | 'name' | 'visible' | 'transparency' | 'hullProperties'>;

function readLayerGrid(y: Y.Map<unknown>, c: CommonFields): LayerGrid {
  return {
    ...c,
    type: 'grid',
    gridColor: requireScalar(y, 'gridColor') as ColorSpec,
    gridThickness: requireScalar(y, 'gridThickness') as number,
    subGridColor: requireScalar(y, 'subGridColor') as ColorSpec,
    subGridThickness: requireScalar(y, 'subGridThickness') as number,
    gridSizeInStud: requireScalar(y, 'gridSizeInStud') as number,
    subDivisionNumber: requireScalar(y, 'subDivisionNumber') as number,
    displayGrid: requireScalar(y, 'displayGrid') as boolean,
    displaySubGrid: requireScalar(y, 'displaySubGrid') as boolean,
    displayCellIndex: requireScalar(y, 'displayCellIndex') as boolean,
    cellIndexFont: { ...(requireScalar(y, 'cellIndexFont') as FontSpec) },
    cellIndexColor: requireScalar(y, 'cellIndexColor') as ColorSpec,
    cellIndexColumnType: requireScalar(y, 'cellIndexColumnType') as string,
    cellIndexRowType: requireScalar(y, 'cellIndexRowType') as string,
    cellIndexCorner: requireScalar(y, 'cellIndexCorner') as string,
  };
}

function readLayerBrick(y: Y.Map<unknown>, c: CommonFields): LayerBrick {
  const bricksY = y.get('bricks') as Y.Array<Y.Map<unknown>> | undefined;
  const groupsY = y.get('groups') as Y.Array<Y.Map<unknown>> | undefined;
  return {
    ...c,
    type: 'brick',
    displayBrickElevation: requireScalar(y, 'displayBrickElevation') as boolean,
    bricks: bricksY ? bricksY.toArray().map(yMapToBrick) : [],
    groups: groupsY ? groupsY.toArray().map(yMapToGroup) : [],
  };
}

function yMapToBrick(y: Y.Map<unknown>): Brick {
  const connexionsRaw = (y.get('connexions') ?? []) as Connexion[];
  return {
    id: requireScalar(y, 'id') as string,
    displayArea: cloneRect(requireScalar(y, 'displayArea') as RectangleF),
    myGroup: requireScalar(y, 'myGroup') as string,
    partNumber: requireScalar(y, 'partNumber') as string,
    orientation: requireScalar(y, 'orientation') as number,
    activeConnectionPointIndex: requireScalar(y, 'activeConnectionPointIndex') as number,
    altitude: requireScalar(y, 'altitude') as number,
    connexions: connexionsRaw.map((c) => ({ id: c.id, linkedTo: c.linkedTo })),
  };
}

function yMapToGroup(y: Y.Map<unknown>): Group {
  const out: Group = { id: requireScalar(y, 'id') as string };
  if (y.has('partNumber')) out.partNumber = y.get('partNumber') as string;
  if (y.has('orientation')) out.orientation = y.get('orientation') as number;
  if (y.has('altitude')) out.altitude = y.get('altitude') as number;
  if (y.has('myGroup')) out.myGroup = y.get('myGroup') as string;
  return out;
}

function readLayerText(y: Y.Map<unknown>, c: CommonFields): LayerText {
  const cellsY = y.get('textCells') as Y.Array<Y.Map<unknown>> | undefined;
  const groupsY = y.get('groups') as Y.Array<Y.Map<unknown>> | undefined;
  return {
    ...c,
    type: 'text',
    textCells: cellsY ? cellsY.toArray().map(yMapToTextCell) : [],
    groups: groupsY ? groupsY.toArray().map(yMapToGroup) : [],
  };
}

function yMapToTextCell(y: Y.Map<unknown>): TextCell {
  return {
    displayArea: cloneRect(requireScalar(y, 'displayArea') as RectangleF),
    myGroup: requireScalar(y, 'myGroup') as string,
    text: requireScalar(y, 'text') as string,
    orientation: requireScalar(y, 'orientation') as number,
    fontColor: requireScalar(y, 'fontColor') as ColorSpec,
    font: { ...(requireScalar(y, 'font') as FontSpec) },
    textAlignment: requireScalar(y, 'textAlignment') as string,
  };
}

function readLayerArea(y: Y.Map<unknown>, c: CommonFields): LayerArea {
  const areasY = y.get('areas') as Y.Array<AreaCell> | undefined;
  return {
    ...c,
    type: 'area',
    areaCellSize: requireScalar(y, 'areaCellSize') as number,
    areas: areasY ? areasY.toArray().map((a) => ({ ...a })) : [],
  };
}

function readLayerRuler(y: Y.Map<unknown>, c: CommonFields): LayerRuler {
  const groupsY = y.get('groups') as Y.Array<Y.Map<unknown>> | undefined;
  return {
    ...c,
    type: 'ruler',
    rulerItems: [],
    groups: groupsY ? groupsY.toArray().map(yMapToGroup) : [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneRect(r: RectangleF): RectangleF {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function cloneHull(h: HullProperties): HullProperties {
  return { isVisible: h.isVisible, hullColor: h.hullColor, hullThickness: h.hullThickness };
}

function cloneExportInfo(info: ExportInfo): ExportInfo {
  return {
    exportPath: info.exportPath,
    exportFileType: info.exportFileType,
    exportArea: cloneRect(info.exportArea),
    exportScale: info.exportScale,
    exportWatermark: info.exportWatermark,
    exportElectricCircuit: info.exportElectricCircuit,
    exportConnectionPoints: info.exportConnectionPoints,
  };
}

function requireScalar(y: Y.Map<unknown>, key: string): unknown {
  const v = y.get(key);
  if (v === undefined) throw new Error(`missing key in Y.Map: ${key}`);
  return v;
}
