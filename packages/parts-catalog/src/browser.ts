// Browser-safe entrypoint — no `node:fs` imports. The web app uses this
// to access the in-memory catalog types, the XML parser, and the
// connectivity-recompute algorithm without pulling the directory scanner
// (which lives in scan.ts behind `node:fs/promises`).

export type { Catalog, ConnectionPoint, PartKind, PartMetadata, SubPart } from './types.js';
export { parsePartXml, type ParseInput } from './parse.js';
export { rebuildConnectivity, type RebuildConnectivityResult } from './connectivity.js';
export { footprint, imageOffset, type Footprint, type FootprintPart } from './footprint.js';
export { imageSize, type ImageSize } from './imageSize.js';
export { connectionHingeAngle, FlexMove, type FlexState } from './flexMove.js';
export type { FourDBrixRemap, FourDBrixType, LDrawRemap, TrackDesignerPort, TrackDesignerRemap } from './types.js';
export { MapLibrary, type MapReadResult } from './mapformats/library.js';
export { readFourDBrixMap, writeFourDBrixMap } from './mapformats/fourDBrix.js';
export { readTrackDesignerMap, writeTrackDesignerMap } from './mapformats/trackDesigner.js';
export { readLDrawMap, writeLDrawMap } from './mapformats/ldraw.js';
