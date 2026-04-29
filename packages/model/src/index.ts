// Shared TS types for the .bbm map model. Mirrors the desktop CLD's
// `src/core/` data model without depending on Qt/C++. Used by:
//   - packages/bbm  → reads/writes .bbm + .bbm.cld
//   - packages/ydoc → seeds and reconstructs Yjs docs
//   - apps/web      → drives Konva rendering
//   - apps/server   → import/export + access rules
//
// IDs are strings: vanilla BlueBrick uses decimal `ulong` ids, the desktop
// fork uses GUIDs and migrates to numeric on save. We preserve whatever was
// on disk and let the writer decide what to emit.
//
// The on-disk XML is pinned by a property test against vendored fixtures —
// see packages/bbm/tests/fixtures/.

export const BBM_FORMAT_VERSION = 9;

// ---------------------------------------------------------------------------
// Primitive value types
// ---------------------------------------------------------------------------

export interface RectangleF {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PointF {
  x: number;
  y: number;
}

/**
 * BlueBrick's color spec is two-element: a `IsKnownColor` flag plus a Name
 * field that's either a known-color name (e.g. "CornflowerBlue") or a raw
 * ARGB hex string ("ffd3d3d3").
 *
 * We expose this as a tagged union so callers don't have to inspect both
 * fields. The writer flattens it back to the IsKnownColor/Name pair.
 */
export type ColorSpec = { kind: 'known'; name: string } | { kind: 'argb'; argb: string };

/** Font as serialised in TextCells. */
export interface FontSpec {
  family: string;
  size: number;
  /** Comma-separated style list — matches .NET's FontStyle.ToString(). */
  style: string;
}

export interface ExportInfo {
  exportPath: string;
  exportFileType: number;
  exportArea: RectangleF;
  exportScale: number;
  exportWatermark: boolean;
  exportElectricCircuit: boolean;
  exportConnectionPoints: boolean;
}

// ---------------------------------------------------------------------------
// Layer model — discriminated union
// ---------------------------------------------------------------------------

export type LayerType = 'grid' | 'brick' | 'text' | 'area' | 'ruler';

interface LayerCommon {
  id: string;
  /** Non-null on every fixture we've seen, but the schema allows missing. */
  name: string;
  visible: boolean;
  /** Percent (0-100). Required at v9. */
  transparency: number;
  hullProperties: HullProperties;
}

export interface HullProperties {
  isVisible: boolean;
  hullColor: ColorSpec;
  hullThickness: number;
}

export interface LayerGrid extends LayerCommon {
  type: 'grid';
  gridColor: ColorSpec;
  gridThickness: number;
  subGridColor: ColorSpec;
  subGridThickness: number;
  gridSizeInStud: number;
  subDivisionNumber: number;
  displayGrid: boolean;
  displaySubGrid: boolean;
  displayCellIndex: boolean;
  cellIndexFont: FontSpec;
  cellIndexColor: ColorSpec;
  cellIndexColumnType: string;
  cellIndexRowType: string;
  cellIndexCorner: string;
}

export interface Connexion {
  id: string;
  /** GUID of the linked brick, or empty string when unlinked. */
  linkedTo: string;
}

export interface Brick {
  id: string;
  displayArea: RectangleF;
  /** Empty string when not in a group. */
  myGroup: string;
  partNumber: string;
  orientation: number;
  activeConnectionPointIndex: number;
  altitude: number;
  connexions: Connexion[];
}

export interface Group {
  id: string;
  partNumber?: string;
  orientation?: number;
  altitude?: number;
  /** Parent group (for nested groups), empty when at top level. */
  myGroup?: string;
}

export interface LayerBrick extends LayerCommon {
  type: 'brick';
  /** v9+ flag controlling 3D elevation rendering. */
  displayBrickElevation: boolean;
  bricks: Brick[];
  groups: Group[];
}

export interface TextCell {
  displayArea: RectangleF;
  myGroup: string;
  text: string;
  orientation: number;
  fontColor: ColorSpec;
  font: FontSpec;
  /** "Near" | "Center" | "Far". */
  textAlignment: string;
}

export interface LayerText extends LayerCommon {
  type: 'text';
  textCells: TextCell[];
  groups: Group[];
}

export interface AreaCell {
  x: number;
  y: number;
  /** Per the format survey, area cells use UPPERCASE hex unlike other ColorSpec uses. */
  color: string;
}

export interface LayerArea extends LayerCommon {
  type: 'area';
  /** Element name on disk is `<AreaCellSize>`, NOT `<AreaCellSizeInStud>`. */
  areaCellSize: number;
  areas: AreaCell[];
}

export type RulerItem =
  | ({ kind: 'linear' } & Record<string, unknown>)
  | ({ kind: 'circular' } & Record<string, unknown>);

export interface LayerRuler extends LayerCommon {
  type: 'ruler';
  rulerItems: RulerItem[];
  groups: Group[];
}

export type Layer = LayerGrid | LayerBrick | LayerText | LayerArea | LayerRuler;

// ---------------------------------------------------------------------------
// Map (the document root)
// ---------------------------------------------------------------------------

export interface MapDate {
  day: number;
  month: number;
  year: number;
}

export interface BbmMap {
  /** Always `BBM_FORMAT_VERSION` for newly authored docs. Preserved on import. */
  version: number;
  /** Sum of items across all layers — re-derived on write. */
  nbItems: number;
  backgroundColor: ColorSpec;
  author: string;
  lug: string;
  event: string;
  date: MapDate;
  comment: string;
  exportInfo: ExportInfo;
  selectedLayerIndex: number;
  layers: Layer[];
}
