// In-memory catalog types for BlueBrickParts metadata.
//
// XML files in `parts-library/parts/**/*.xml` describe individual leaf
// parts (`<part>`) or composite groups (`<group>`). The library key for
// each entry is `"<partNumber>.<colorCode>"` lowercased (e.g.
// "ts_curve_r56.8"); the `.set.xml` suffix is stripped for groups.

export type PartKind = 'leaf' | 'group';

/**
 * One connection point on a part. Stored in **local part coords**, in studs.
 * The world position of a placed brick's connection point is computed by
 * `rotate(c.position, brick.orientation) + brick.displayArea.center`.
 */
export interface ConnectionPoint {
  /**
   * Connection type. **Arbitrary string**, NOT an enum:
   * "1" = rail, "2" = road, "3" = monorail, etc., but custom packs ship
   * their own types ("rail", "road", "coaster", "magnet", ...). Empty
   * string means "never connects".
   */
  type: string;
  /** Local x (studs). Floats with high precision are common. */
  x: number;
  /** Local y (studs). */
  y: number;
  /** Outward angle in degrees. */
  angle: number;
  /**
   * 0 (the default when absent) means no electrical plug. A circuit joins
   * two connection points of one part whose plugs are opposite (+1 / -1,
   * +2 / -2; desktop PartsLibrary.cpp buildElectricCircuits). NOT used by
   * the geometric matching pass — purely metadata.
   */
  electricPlug: number;
  /** UI hint for "tab next" routing. 0-based index into the part's connection list. */
  nextConnexionPreference?: number;
  angleToPrev?: number;
  angleToNext?: number;
}

/** A part's `<SnapMargin>`, in studs. */
export interface SnapMargin {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A child part inside a `<group>`. */
export interface SubPart {
  /** Library key of the referenced part: `"<partNumber>.<colorCode>"` lowercased. */
  subKey: string;
  /** Local position in studs. */
  x: number;
  y: number;
  angle: number;
}

export interface PartMetadata {
  /** Library key — what callers look up. */
  key: string;
  partNumber: string;
  colorCode: string;
  kind: PartKind;
  /** Multilingual short descriptions, keyed by ISO language code. */
  descriptions: Record<string, string>;
  author: string;
  sortingKey: string;
  /**
   * Path of the matching sprite, relative to the parts-library root. Empty
   * if no sprite was found alongside the XML. Lookup order: .gif, .png,
   * .jpg, .jpeg.
   */
  spritePath: string;
  /**
   * Path of the part's XML, relative to the parts-library root. Set
   * by the catalog scanner; unit tests that build `PartMetadata`
   * directly (without a filesystem path) leave it empty. Used to
   * derive the UI "category" for the parts panel — desktop does the
   * same via `QFileInfo(xmlPath).dir().dirName()`
   * (PartsBrowser.cpp:198-202).
   */
  xmlRelPath?: string;
  /** Pixels per stud at which the sprite is rendered. Defaults to 8. */
  pxPerStud: number;
  /** Empty for groups. */
  connections: ConnectionPoint[];
  /** Empty for leaf parts. */
  subparts: SubPart[];
  /**
   * Whether the user can ungroup a placed instance. Only meaningful for
   * groups; defaults true.
   */
  canUngroup: boolean;
  /**
   * A set's `<GroupConnectionPreferenceList>`: from a connection of the set
   * (its parts' connections, numbered in sub-part order) to the one to add
   * the next part at (flex.group: 0 <-> 2). Groups only; absent when none.
   */
  groupNextPreferred?: Record<number, number>;
  /**
   * Optional hull polygon from `<hull>` in the XML. Points are in **pixel
   * space** relative to the sprite's top-left corner (not studs). Empty
   * array means "use the sprite bounding rect as proxy" (desktop behaviour
   * for parts without an explicit hull).
   */
  hullPts: { x: number; y: number }[];
  /**
   * `<SnapMargin>`: the margin inside the sprite that grid snapping leaves
   * out, in studs (a 9V straight's half stud each side of the rails).
   * Absent when the part has none.
   */
  snapMargin?: SnapMargin;
  /**
   * `<PickShape>` of an imported part: its outline rings (holes included),
   * in studs around the sprite centre. Used for picking and the selection
   * outline only; the footprint still comes from the sprite. Absent when none.
   */
  pickShape?: { x: number; y: number }[][];
  /**
   * `<Designer url="…">Name</Designer>`: who built the model an imported
   * part was made from (the desktop's import dialog). Absent when none.
   */
  designer?: { name: string; url?: string };
  /**
   * Earlier part numbers (`<OldNameList><OldName>`); maps and budgets
   * that use one resolve to this part (desktop PartsLibrary canonicalKey).
   * Optional so hand-built test metadata can leave it out.
   */
  oldNames?: string[];
  /** Sprite size in pixels, read from the image header by the scanner; needed for the footprint. */
  spriteSize?: { w: number; h: number };
  /** `<LDraw>` remap, for LDraw (.ldr/.mpd) maps. */
  ldraw?: LDrawRemap;
  /** `<TrackDesigner>` remap, for TrackDesigner (.tdl) maps. */
  trackDesigner?: TrackDesignerRemap;
  /** `<FourDBrix>` remap, for 4DBrix nControl (.ncp) maps. */
  fourDBrix?: FourDBrixRemap;
}

/**
 * How the LDraw part's origin and orientation map onto this part's
 * sprite centre (desktop PartsLibrary readLDrawRemap).
 */
export interface LDrawRemap {
  /** Degrees. */
  angle: number;
  /** LDU. */
  translation: { x: number; y: number };
  /** LDU; written when the brick's altitude is 0. */
  preferredHeight: number;
  /** `"<part>.<color>"` sleeper put under the rails on save, or ''. */
  sleeper: string;
  /** `"<part>[.<color>]"` written instead of this part, or ''. */
  alias: string;
}

export interface TrackDesignerPort {
  /** BlueBrick connection used as the TrackDesigner origin. */
  bbConnectionIndex: number;
  /** TrackDesigner piece type (0 straight, 1 left curve, ... 20 custom). */
  type: number;
  /** TrackDesigner angle minus BlueBrick angle, degrees. */
  angleDifference: number;
}

export interface TrackDesignerRemap {
  defaultId: number;
  /** TrackDesigner "registry" (part set) → id. */
  registryIds: Record<string, number>;
  flags: number;
  hasSeveralPorts: boolean;
  ports: TrackDesignerPort[];
}

export type FourDBrixType = 'segment' | 'table' | 'baseplate' | 'structure';

export interface FourDBrixRemap {
  type: FourDBrixType;
  /** Segment name, or svg path, in nControl. */
  partName: string;
  orientationDifference: number;
  /** Connection used as the segment origin. */
  originConnection: number;
}

/** A loaded library — a flat map keyed by lowercased `<partNumber>.<colorCode>`. */
export type Catalog = Map<string, PartMetadata>;
