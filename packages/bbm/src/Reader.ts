import { XMLParser } from 'fast-xml-parser';
import type {
  BbmMap,
  Brick,
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
  LayerType,
  LinearRulerItem,
  CircularRulerItem,
  RectangleF,
  RulerItem,
  TextCell,
} from '@cld/model';
import { readColorSpec } from './color.js';
import { parseBool } from './format.js';

// Parser config:
//   - preserve attributes under a stable key (`@`)
//   - keep text as strings (we re-parse numbers ourselves so we never silently
//     drop precision the way auto-typing can)
//   - never trim whitespace inside <Text>...</Text> content
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  textNodeName: '#text',
});

type Node = Record<string, unknown>;

export interface ReadResult {
  map: BbmMap;
  /** Warnings about unrecognised content (forward compat). */
  warnings: string[];
}

export function readBbm(xml: string): ReadResult {
  const tree = parser.parse(xml) as Node;
  const root = required<Node>(tree, 'Map');
  const warnings: string[] = [];

  const map: BbmMap = {
    version: parseInt(stringField(root, 'Version'), 10),
    nbItems: parseInt(stringField(root, 'nbItems'), 10),
    backgroundColor: readColorSpec(required<Node>(root, 'BackgroundColor')),
    author: stringField(root, 'Author'),
    lug: stringField(root, 'LUG'),
    event: stringField(root, 'Event'),
    date: readDate(required<Node>(root, 'Date')),
    comment: optionalString(root, 'Comment') ?? '',
    exportInfo: readExportInfo(required<Node>(root, 'ExportInfo')),
    selectedLayerIndex: parseInt(stringField(root, 'SelectedLayerIndex'), 10),
    layers: readLayers(root.Layers, warnings),
  };

  return { map, warnings };
}

// ---------------------------------------------------------------------------
// Element-level readers
// ---------------------------------------------------------------------------

function readDate(node: Node): { day: number; month: number; year: number } {
  return {
    day: parseInt(stringField(node, 'Day'), 10),
    month: parseInt(stringField(node, 'Month'), 10),
    year: parseInt(stringField(node, 'Year'), 10),
  };
}

function readExportInfo(node: Node): ExportInfo {
  return {
    exportPath: stringField(node, 'ExportPath'),
    exportFileType: parseInt(stringField(node, 'ExportFileType'), 10),
    exportArea: readRect(required<Node>(node, 'ExportArea')),
    exportScale: parseFloat(stringField(node, 'ExportScale')),
    exportWatermark: parseBool(stringField(node, 'ExportWatermark')),
    exportElectricCircuit: parseBool(stringField(node, 'ExportElectricCircuit')),
    exportConnectionPoints: parseBool(stringField(node, 'ExportConnectionPoints')),
  };
}

function readRect(node: Node): RectangleF {
  return {
    x: parseFloat(stringField(node, 'X')),
    y: parseFloat(stringField(node, 'Y')),
    width: parseFloat(stringField(node, 'Width')),
    height: parseFloat(stringField(node, 'Height')),
  };
}

function readHullProperties(node: Node): HullProperties {
  return {
    isVisible: parseBool(stringAttr(node, 'isVisible')),
    hullColor: readColorSpec(required<Node>(node, 'hullColor')),
    hullThickness: parseInt(stringField(node, 'hullThickness'), 10),
  };
}

function readFont(node: Node): FontSpec {
  return {
    family: stringField(node, 'FontFamily'),
    size: parseFloat(stringField(node, 'Size')),
    style: stringField(node, 'Style'),
  };
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function readLayers(layersNode: unknown, warnings: string[]): Layer[] {
  if (!layersNode) return [];
  const node = layersNode as Node;
  const raw = node.Layer;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];

  const out: Layer[] = [];
  for (const item of list) {
    const layerNode = item as Node;
    const type = stringAttr(layerNode, 'type') as LayerType;
    const id = stringAttr(layerNode, 'id');
    const common = {
      id,
      name: optionalString(layerNode, 'Name') ?? '',
      visible: parseBool(stringField(layerNode, 'Visible')),
      transparency: parseInt(stringField(layerNode, 'Transparency'), 10),
      hullProperties: readHullProperties(required<Node>(layerNode, 'HullProperties')),
    };

    switch (type) {
      case 'grid':
        out.push(readLayerGrid(layerNode, common));
        break;
      case 'brick':
        out.push(readLayerBrick(layerNode, common));
        break;
      case 'text':
        out.push(readLayerText(layerNode, common));
        break;
      case 'area':
        out.push(readLayerArea(layerNode, common));
        break;
      case 'ruler':
        out.push(readLayerRuler(layerNode, common));
        break;
      default:
        warnings.push(`unknown layer type: ${String(type)}; skipped`);
    }
  }
  return out;
}

function readLayerGrid(n: Node, c: Omit<LayerGrid, 'type' | keyof LayerGridOnly>): LayerGrid {
  return {
    ...c,
    type: 'grid',
    gridColor: readColorSpec(required<Node>(n, 'GridColor')),
    // Desktop reads these as float (LayerIO.cpp:120,122), so do the same
    // here — otherwise fractional thickness from a desktop-saved file is
    // lost on round-trip.
    gridThickness: parseFloat(stringField(n, 'GridThickness')),
    subGridColor: readColorSpec(required<Node>(n, 'SubGridColor')),
    subGridThickness: parseFloat(stringField(n, 'SubGridThickness')),
    gridSizeInStud: parseInt(stringField(n, 'GridSizeInStud'), 10),
    subDivisionNumber: parseInt(stringField(n, 'SubDivisionNumber'), 10),
    displayGrid: parseBool(stringField(n, 'DisplayGrid')),
    displaySubGrid: parseBool(stringField(n, 'DisplaySubGrid')),
    displayCellIndex: parseBool(stringField(n, 'DisplayCellIndex')),
    cellIndexFont: readFont(required<Node>(n, 'CellIndexFont')),
    cellIndexColor: readColorSpec(required<Node>(n, 'CellIndexColor')),
    cellIndexColumnType: stringField(n, 'CellIndexColumnType'),
    cellIndexRowType: stringField(n, 'CellIndexRowType'),
    cellIndexCorner: stringField(n, 'CellIndexCorner'),
  };
}
type LayerGridOnly = Omit<LayerGrid, keyof LayerBrick & keyof LayerGrid>;

function readLayerBrick(n: Node, c: Omit<LayerBrick, 'type' | 'displayBrickElevation' | 'bricks' | 'groups'>): LayerBrick {
  return {
    ...c,
    type: 'brick',
    displayBrickElevation: parseBool(optionalString(n, 'DisplayBrickElevation') ?? 'false'),
    bricks: readBricks(n.Bricks),
    groups: readGroups(n.Groups),
  };
}

function readLayerText(n: Node, c: Omit<LayerText, 'type' | 'textCells' | 'groups'>): LayerText {
  return {
    ...c,
    type: 'text',
    textCells: readTextCells(n.TextCells),
    groups: readGroups(n.Groups),
  };
}

function readLayerArea(n: Node, c: Omit<LayerArea, 'type' | 'areaCellSize' | 'areas'>): LayerArea {
  return {
    ...c,
    type: 'area',
    areaCellSize: parseInt(stringField(n, 'AreaCellSize'), 10),
    areas: readAreas(n.Areas),
  };
}

function readLayerRuler(n: Node, c: Omit<LayerRuler, 'type' | 'rulerItems' | 'groups'>): LayerRuler {
  return {
    ...c,
    type: 'ruler',
    rulerItems: readRulerItems(n.RulerItems),
    groups: readGroups(n.Groups),
  };
}

/**
 * Parse `<RulerItems>`. Mirrors desktop `readLayerRuler`/`readRulerItem`
 * (saveload/LayerIO.cpp:395-465). Each child is either a
 * `<LinearRuler>` or `<CircularRuler>` element. Field order follows
 * `RulerItemBase` (LayerIO.cpp:381-393) plus the subclass-specific
 * fields appended at the end.
 */
function readRulerItems(node: unknown): RulerItem[] {
  if (!node || typeof node !== 'object') return [];
  const out: RulerItem[] = [];
  const linear = (node as Node).LinearRuler;
  for (const item of asArray<unknown>(linear)) {
    if (item && typeof item === 'object') out.push(readLinearRuler(item as Node));
  }
  const circular = (node as Node).CircularRuler;
  for (const item of asArray<unknown>(circular)) {
    if (item && typeof item === 'object') out.push(readCircularRuler(item as Node));
  }
  return out;
}

function readLinearRuler(n: Node): LinearRulerItem {
  return {
    kind: 'linear',
    ...readRulerCommon(n),
    point1: readPoint(required<Node>(n, 'Point1')),
    point2: readPoint(required<Node>(n, 'Point2')),
    attachedBrick1Id: optionalString(n, 'AttachedBrick1') ?? '',
    attachedBrick2Id: optionalString(n, 'AttachedBrick2') ?? '',
    offsetDistance: parseFloat(stringField(n, 'OffsetDistance')),
    allowOffset: parseBool(stringField(n, 'AllowOffset')),
  };
}

function readCircularRuler(n: Node): CircularRulerItem {
  return {
    kind: 'circular',
    ...readRulerCommon(n),
    center: readPoint(required<Node>(n, 'Center')),
    radius: parseFloat(stringField(n, 'Radius')),
    attachedBrickId: optionalString(n, 'AttachedBrick') ?? '',
  };
}

function readRulerCommon(n: Node) {
  return {
    // Mint a fresh id on read — `<LinearRuler>`/`<CircularRuler>` XML
    // has no id attribute upstream, so every load assigns new ids.
    // That's fine: ruler ids are in-memory only and never persisted.
    // Mirrors desktop's `LayerItem.guid = newBbmId()` at
    // RulerCommands.cpp:33 / 102 / 169 etc.
    id: mintRulerId(),
    displayArea: readRect(required<Node>(n, 'DisplayArea')),
    myGroup: optionalString(n, 'MyGroup') ?? '',
    color: readColorSpec(required<Node>(n, 'Color')),
    lineThickness: parseFloat(stringField(n, 'LineThickness')),
    displayDistance: parseBool(stringField(n, 'DisplayDistance')),
    displayUnit: parseBool(stringField(n, 'DisplayUnit')),
    guidelineColor: readColorSpec(required<Node>(n, 'GuidelineColor')),
    guidelineThickness: parseFloat(stringField(n, 'GuidelineThickness')),
    guidelineDashPattern: readFloatArray(n.GuidelineDashPattern),
    unit: parseInt(stringField(n, 'Unit'), 10),
    measureFont: readFont(required<Node>(n, 'MeasureFont')),
    measureFontColor: readColorSpec(required<Node>(n, 'MeasureFontColor')),
  };
}

function mintRulerId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0')}`;
}

function readPoint(node: Node): { x: number; y: number } {
  return {
    x: parseFloat(stringField(node, 'X')),
    y: parseFloat(stringField(node, 'Y')),
  };
}

/**
 * `<GuidelineDashPattern><double>1.5</double><double>2</double>…</GuidelineDashPattern>`
 * fast-xml-parser collapses single-child arrays to a string, so accept
 * both shapes.
 */
function readFloatArray(node: unknown): number[] {
  if (!node || typeof node !== 'object') return [];
  const inner = (node as Node).double;
  if (inner === undefined) return [];
  return asArray(inner)
    .map((v) => (typeof v === 'string' ? parseFloat(v) : Number(v)))
    .filter((v) => Number.isFinite(v));
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// Sub-collections
// ---------------------------------------------------------------------------

function readBricks(node: unknown): Brick[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Node).Brick;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((b) => readBrick(b as Node));
}

function readBrick(n: Node): Brick {
  return {
    id: stringAttr(n, 'id'),
    displayArea: readRect(required<Node>(n, 'DisplayArea')),
    myGroup: optionalString(n, 'MyGroup') ?? '',
    partNumber: stringField(n, 'PartNumber'),
    orientation: parseFloat(stringField(n, 'Orientation')),
    activeConnectionPointIndex: parseInt(stringField(n, 'ActiveConnectionPointIndex'), 10),
    altitude: parseFloat(stringField(n, 'Altitude')),
    connexions: readConnexions(n.Connexions),
  };
}

function readConnexions(node: unknown): Connexion[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Node).Connexion;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((c) => readConnexion(c as Node));
}

function readConnexion(n: Node): Connexion {
  return {
    id: stringAttr(n, 'id'),
    linkedTo: optionalString(n, 'LinkedTo') ?? '',
  };
}

function readTextCells(node: unknown): TextCell[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Node).TextCell;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((t) => readTextCell(t as Node));
}

function readTextCell(n: Node): TextCell {
  return {
    displayArea: readRect(required<Node>(n, 'DisplayArea')),
    myGroup: optionalString(n, 'MyGroup') ?? '',
    text: optionalString(n, 'Text') ?? '',
    orientation: parseFloat(stringField(n, 'Orientation')),
    fontColor: readColorSpec(required<Node>(n, 'FontColor')),
    font: readFont(required<Node>(n, 'Font')),
    textAlignment: stringField(n, 'TextAlignment'),
  };
}

function readAreas(node: unknown): { x: number; y: number; color: string }[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Node).Area;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((a) => {
    const an = a as Node;
    return {
      x: parseInt(stringField(an, 'x'), 10),
      y: parseInt(stringField(an, 'y'), 10),
      color: stringField(an, 'color'),
    };
  });
}

function readGroups(node: unknown): Group[] {
  if (!node || typeof node !== 'object') return [];
  const raw = (node as Node).Group;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((g) => {
    const gn = g as Node;
    const out: Group = { id: stringAttr(gn, 'id') };
    const partNumber = optionalString(gn, 'PartNumber');
    if (partNumber !== undefined) out.partNumber = partNumber;
    const orientation = optionalString(gn, 'Orientation');
    if (orientation !== undefined) out.orientation = parseFloat(orientation);
    const altitude = optionalString(gn, 'Altitude');
    if (altitude !== undefined) out.altitude = parseFloat(altitude);
    const myGroup = optionalString(gn, 'MyGroup');
    if (myGroup !== undefined) out.myGroup = myGroup;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function stringField(node: Node, key: string): string {
  const raw = node[key];
  if (raw === undefined || raw === null) {
    throw new Error(`missing required field: ${key}`);
  }
  if (typeof raw === 'object' && '#text' in (raw as Node)) {
    return String((raw as Node)['#text']);
  }
  return String(raw);
}

/**
 * Returns the text content of an element if present, or `undefined` if the
 * element is missing OR self-closed (`<Comment />`). The two are
 * indistinguishable in the parsed tree because fast-xml-parser collapses
 * `<Foo />` to an empty string node.
 */
function optionalString(node: Node, key: string): string | undefined {
  const raw = node[key];
  if (raw === undefined || raw === null) return undefined;
  if (raw === '') return '';
  if (typeof raw === 'object' && '#text' in (raw as Node)) {
    const t = (raw as Node)['#text'];
    return t === undefined || t === null ? '' : String(t);
  }
  return String(raw);
}

function stringAttr(node: Node, attr: string): string {
  const v = node[`@${attr}`];
  if (v === undefined || v === null) throw new Error(`missing attribute: ${attr}`);
  return String(v);
}

function required<T>(node: Node, key: string): T {
  const v = node[key];
  if (v === undefined || v === null) throw new Error(`missing required element: ${key}`);
  return v as T;
}
