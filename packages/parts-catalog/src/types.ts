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
   * -1 means no electrical plug. 0 / 1 / ... are plug indices; circuits form
   * only between two connection points where `electricPlug != -1`. NOT used
   * by the geometric matching pass — purely metadata.
   */
  electricPlug: number;
  /** UI hint for "tab next" routing. 0-based index into the part's connection list. */
  nextConnexionPreference?: number;
  angleToPrev?: number;
  angleToNext?: number;
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
}

/** A loaded library — a flat map keyed by lowercased `<partNumber>.<colorCode>`. */
export type Catalog = Map<string, PartMetadata>;
