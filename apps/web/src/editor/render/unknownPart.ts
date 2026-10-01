// A part the library doesn't know, drawn as vanilla BlueBrick draws it
// (BrickLibrary.cs createUnknownImage): a picture the brick's stored size
// in whole studs, a red cross corner to corner, and the part number in
// black in the middle, turned with the brick. The desktop draws the same
// (rendering/UnknownPart.h); render-parity/parts.json holds the numbers.

/** Vanilla's picture density for parts, which is also the map's scene px per stud. */
const PX_PER_STUD = 8;

export interface UnknownPartLook {
  /** The picture's size in scene px (whole studs). */
  width: number;
  height: number;
  /** The cross's pen. */
  penPx: number;
  /** The part number's font size in px (vanilla's points at 96 dpi). */
  fontPx: number;
}

export function unknownPartLook(partNumber: string, widthStuds: number, heightStuds: number): UnknownPartLook {
  const width = Math.trunc(widthStuds) * PX_PER_STUD;
  const height = Math.trunc(heightStuds) * PX_PER_STUD;
  const penPx = Math.max(1, Math.trunc(Math.max(width, height) / 16));
  const pt = partNumber.length > 0 ? Math.max(4, Math.min(width, height) / partNumber.length) : 4;
  return { width, height, penPx, fontPx: (pt * 4) / 3 };
}
