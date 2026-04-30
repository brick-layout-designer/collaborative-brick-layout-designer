import type {
  BbmMap,
  Brick,
  CircularRulerItem,
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
  LinearRulerItem,
  RectangleF,
  RulerItem,
  TextCell,
} from '@cld/model';
import { writeColorSpec } from './color.js';
import { formatBool, formatInt, formatNumber } from './format.js';
import { vanillaPostProcess, XmlBuilder } from './xml.js';

export interface WriteOptions {
  /**
   * If set, the writer recomputes `nbItems` from the layer contents (sum of
   * bricks + textCells + areas + rulers). Defaults to true since the field
   * is supposed to be derived. Set false to preserve a stale value
   * verbatim — useful for byte-identity round-trips on imported files.
   */
  recomputeNbItems?: boolean;
}

export function writeBbm(map: BbmMap, opts: WriteOptions = {}): string {
  const recompute = opts.recomputeNbItems ?? true;
  const nbItems = recompute ? computeNbItems(map.layers) : map.nbItems;

  const b = new XmlBuilder();
  b.prolog();
  b.open('Map');
  b.textElement('Version', formatInt(map.version));
  b.textElement('nbItems', formatInt(nbItems));
  writeColorBlock(b, 'BackgroundColor', map.backgroundColor);
  b.textElement('Author', map.author);
  b.textElement('LUG', map.lug);
  b.textElement('Event', map.event);
  b.open('Date');
  b.textElement('Day', formatInt(map.date.day));
  b.textElement('Month', formatInt(map.date.month));
  b.textElement('Year', formatInt(map.date.year));
  b.close('Date');
  b.optionalTextElement('Comment', map.comment);
  writeExportInfo(b, map.exportInfo);
  b.textElement('SelectedLayerIndex', formatInt(map.selectedLayerIndex));
  writeLayers(b, map.layers);
  b.close('Map');
  return vanillaPostProcess(b.build());
}

// ---------------------------------------------------------------------------
// Element writers
// ---------------------------------------------------------------------------

function writeColorBlock(b: XmlBuilder, name: string, color: { kind: 'known'; name: string } | { kind: 'argb'; argb: string }): void {
  b.open(name);
  writeColorSpec(b, color);
  b.close(name);
}

function writeRect(b: XmlBuilder, name: string, rect: RectangleF): void {
  // Desktop emits these via writeFloatElement (G7) — see
  // saveload/XmlPrimitives.cpp:196-203. G15 here would break byte-identity
  // round-trip on every brick whose coords aren't exact integers.
  b.open(name);
  b.textElement('X', formatNumber(rect.x, 'g7'));
  b.textElement('Y', formatNumber(rect.y, 'g7'));
  b.textElement('Width', formatNumber(rect.width, 'g7'));
  b.textElement('Height', formatNumber(rect.height, 'g7'));
  b.close(name);
}

function writeExportInfo(b: XmlBuilder, info: ExportInfo): void {
  b.open('ExportInfo');
  b.textElement('ExportPath', info.exportPath);
  b.textElement('ExportFileType', formatInt(info.exportFileType));
  writeRect(b, 'ExportArea', info.exportArea);
  b.textElement('ExportScale', formatNumber(info.exportScale));
  b.textElement('ExportWatermark', formatBool(info.exportWatermark));
  b.textElement('ExportElectricCircuit', formatBool(info.exportElectricCircuit));
  b.textElement('ExportConnectionPoints', formatBool(info.exportConnectionPoints));
  b.close('ExportInfo');
}

function writeHullProperties(b: XmlBuilder, hp: HullProperties): void {
  b.open('HullProperties', { isVisible: formatBool(hp.isVisible) });
  writeColorBlock(b, 'hullColor', hp.hullColor);
  b.textElement('hullThickness', formatInt(hp.hullThickness));
  b.close('HullProperties');
}

function writeFont(b: XmlBuilder, name: string, font: FontSpec): void {
  b.open(name);
  b.textElement('FontFamily', font.family);
  b.textElement('Size', formatNumber(font.size, 'g7'));
  b.textElement('Style', font.style);
  b.close(name);
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

function writeLayers(b: XmlBuilder, layers: Layer[]): void {
  b.open('Layers');
  for (const layer of layers) writeLayer(b, layer);
  b.close('Layers');
}

function writeLayer(b: XmlBuilder, layer: Layer): void {
  b.open('Layer', { type: layer.type, id: layer.id });
  b.optionalTextElement('Name', layer.name);
  b.textElement('Visible', formatBool(layer.visible));
  b.textElement('Transparency', formatInt(layer.transparency));
  writeHullProperties(b, layer.hullProperties);

  switch (layer.type) {
    case 'grid':
      writeLayerGridBody(b, layer);
      break;
    case 'brick':
      writeLayerBrickBody(b, layer);
      break;
    case 'text':
      writeLayerTextBody(b, layer);
      break;
    case 'area':
      writeLayerAreaBody(b, layer);
      break;
    case 'ruler':
      writeLayerRulerBody(b, layer);
      break;
  }

  b.close('Layer');
}

function writeLayerGridBody(b: XmlBuilder, layer: LayerGrid): void {
  writeColorBlock(b, 'GridColor', layer.gridColor);
  // Desktop writes these via writeFloatElement (LayerIO.cpp:141,143),
  // i.e. G7 precision. formatInt would clip a 1.5-px thickness to "1".
  b.textElement('GridThickness', formatNumber(layer.gridThickness, 'g7'));
  writeColorBlock(b, 'SubGridColor', layer.subGridColor);
  b.textElement('SubGridThickness', formatNumber(layer.subGridThickness, 'g7'));
  b.textElement('GridSizeInStud', formatInt(layer.gridSizeInStud));
  b.textElement('SubDivisionNumber', formatInt(layer.subDivisionNumber));
  b.textElement('DisplayGrid', formatBool(layer.displayGrid));
  b.textElement('DisplaySubGrid', formatBool(layer.displaySubGrid));
  b.textElement('DisplayCellIndex', formatBool(layer.displayCellIndex));
  writeFont(b, 'CellIndexFont', layer.cellIndexFont);
  writeColorBlock(b, 'CellIndexColor', layer.cellIndexColor);
  b.textElement('CellIndexColumnType', layer.cellIndexColumnType);
  b.textElement('CellIndexRowType', layer.cellIndexRowType);
  b.textElement('CellIndexCorner', layer.cellIndexCorner);
}

function writeLayerBrickBody(b: XmlBuilder, layer: LayerBrick): void {
  b.textElement('DisplayBrickElevation', formatBool(layer.displayBrickElevation));
  if (layer.bricks.length === 0) {
    b.selfClose('Bricks');
  } else {
    b.open('Bricks');
    for (const brick of layer.bricks) writeBrick(b, brick);
    b.close('Bricks');
  }
  writeGroups(b, layer.groups);
}

function writeBrick(b: XmlBuilder, brick: Brick): void {
  b.open('Brick', { id: brick.id });
  writeRect(b, 'DisplayArea', brick.displayArea);
  b.optionalTextElement('MyGroup', brick.myGroup);
  b.textElement('PartNumber', brick.partNumber);
  b.textElement('Orientation', formatNumber(brick.orientation, 'g7'));
  b.textElement('ActiveConnectionPointIndex', formatInt(brick.activeConnectionPointIndex));
  b.textElement('Altitude', formatNumber(brick.altitude, 'g7'));
  writeConnexions(b, brick.connexions);
  b.close('Brick');
}

function writeConnexions(b: XmlBuilder, connexions: Connexion[]): void {
  if (connexions.length === 0) {
    b.selfClose('Connexions', { count: '0' });
    return;
  }
  b.open('Connexions', { count: formatInt(connexions.length) });
  for (const c of connexions) writeConnexion(b, c);
  b.close('Connexions');
}

function writeConnexion(b: XmlBuilder, c: Connexion): void {
  b.open('Connexion', { id: c.id });
  b.optionalTextElement('LinkedTo', c.linkedTo);
  b.close('Connexion');
}

function writeLayerTextBody(b: XmlBuilder, layer: LayerText): void {
  if (layer.textCells.length === 0) {
    b.selfClose('TextCells');
  } else {
    b.open('TextCells');
    for (const t of layer.textCells) writeTextCell(b, t);
    b.close('TextCells');
  }
  writeGroups(b, layer.groups);
}

function writeTextCell(b: XmlBuilder, t: TextCell): void {
  b.open('TextCell');
  writeRect(b, 'DisplayArea', t.displayArea);
  b.optionalTextElement('MyGroup', t.myGroup);
  b.optionalTextElement('Text', t.text);
  b.textElement('Orientation', formatNumber(t.orientation, 'g7'));
  writeColorBlock(b, 'FontColor', t.fontColor);
  writeFont(b, 'Font', t.font);
  b.textElement('TextAlignment', t.textAlignment);
  b.close('TextCell');
}

function writeLayerAreaBody(b: XmlBuilder, layer: LayerArea): void {
  b.textElement('AreaCellSize', formatInt(layer.areaCellSize));
  if (layer.areas.length === 0) {
    b.selfClose('Areas');
    return;
  }
  b.open('Areas');
  for (const a of layer.areas) {
    b.open('Area');
    b.textElement('x', formatInt(a.x));
    b.textElement('y', formatInt(a.y));
    b.textElement('color', a.color);
    b.close('Area');
  }
  b.close('Areas');
}

function writeLayerRulerBody(b: XmlBuilder, layer: LayerRuler): void {
  if (layer.rulerItems.length === 0) {
    b.selfClose('RulerItems');
  } else {
    b.open('RulerItems');
    for (const item of layer.rulerItems) writeRulerItem(b, item);
    b.close('RulerItems');
  }
  writeGroups(b, layer.groups);
}

/**
 * Mirror of desktop `writeRulerItem` (saveload/LayerIO.cpp:426-447).
 * Element order: DisplayArea, MyGroup, then RulerItemBase fields, then
 * the subclass-specific fields (Point1/2 + AttachedBrick1/2 +
 * OffsetDistance + AllowOffset for linear; Center + Radius +
 * AttachedBrick for circular).
 */
function writeRulerItem(b: XmlBuilder, item: RulerItem): void {
  if (item.kind === 'linear') {
    b.open('LinearRuler');
    writeRulerCommon(b, item);
    writePoint(b, 'Point1', item.point1);
    writePoint(b, 'Point2', item.point2);
    b.textElement('AttachedBrick1', item.attachedBrick1Id);
    b.textElement('AttachedBrick2', item.attachedBrick2Id);
    b.textElement('OffsetDistance', formatNumber(item.offsetDistance, 'g7'));
    b.textElement('AllowOffset', formatBool(item.allowOffset));
    b.close('LinearRuler');
  } else {
    writeCircularRuler(b, item);
  }
}

function writeCircularRuler(b: XmlBuilder, item: CircularRulerItem): void {
  b.open('CircularRuler');
  writeRulerCommon(b, item);
  writePoint(b, 'Center', item.center);
  b.textElement('Radius', formatNumber(item.radius, 'g7'));
  b.textElement('AttachedBrick', item.attachedBrickId);
  b.close('CircularRuler');
}

function writeRulerCommon(b: XmlBuilder, item: LinearRulerItem | CircularRulerItem): void {
  writeRect(b, 'DisplayArea', item.displayArea);
  b.textElement('MyGroup', item.myGroup);
  writeColorBlock(b, 'Color', item.color);
  b.textElement('LineThickness', formatNumber(item.lineThickness, 'g7'));
  b.textElement('DisplayDistance', formatBool(item.displayDistance));
  b.textElement('DisplayUnit', formatBool(item.displayUnit));
  writeColorBlock(b, 'GuidelineColor', item.guidelineColor);
  b.textElement('GuidelineThickness', formatNumber(item.guidelineThickness, 'g7'));
  writeFloatArray(b, 'GuidelineDashPattern', item.guidelineDashPattern);
  b.textElement('Unit', formatInt(item.unit));
  writeFont(b, 'MeasureFont', item.measureFont);
  writeColorBlock(b, 'MeasureFontColor', item.measureFontColor);
}

function writePoint(b: XmlBuilder, name: string, p: { x: number; y: number }): void {
  b.open(name);
  b.textElement('X', formatNumber(p.x, 'g7'));
  b.textElement('Y', formatNumber(p.y, 'g7'));
  b.close(name);
}

function writeFloatArray(b: XmlBuilder, name: string, values: number[]): void {
  if (values.length === 0) {
    b.selfClose(name);
    return;
  }
  b.open(name);
  for (const v of values) b.textElement('double', formatNumber(v, 'g7'));
  b.close(name);
}

function writeGroups(b: XmlBuilder, groups: Group[]): void {
  if (groups.length === 0) {
    b.selfClose('Groups');
    return;
  }
  b.open('Groups');
  for (const g of groups) {
    b.open('Group', { id: g.id });
    if (g.partNumber !== undefined) b.textElement('PartNumber', g.partNumber);
    if (g.orientation !== undefined) b.textElement('Orientation', formatNumber(g.orientation, 'g7'));
    if (g.altitude !== undefined) b.textElement('Altitude', formatNumber(g.altitude, 'g7'));
    if (g.myGroup !== undefined) b.optionalTextElement('MyGroup', g.myGroup);
    b.close('Group');
  }
  b.close('Groups');
}

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

function computeNbItems(layers: Layer[]): number {
  let total = 0;
  for (const layer of layers) {
    switch (layer.type) {
      case 'brick':
        total += layer.bricks.length;
        break;
      case 'text':
        total += layer.textCells.length;
        break;
      case 'area':
        total += layer.areas.length;
        break;
      case 'ruler':
        total += layer.rulerItems.length;
        break;
      // grid layers contribute 0
    }
  }
  return total;
}
