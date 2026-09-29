export type { Catalog, ConnectionPoint, PartKind, PartMetadata, SubPart } from './types.js';
export { parsePartXml, type ParseInput } from './parse.js';
export { scanCatalog, statRoot, type ScanResult } from './scan.js';
export { rebuildConnectivity, type RebuildConnectivityResult } from './connectivity.js';
export { footprint, imageOffset, type Footprint, type FootprintPart } from './footprint.js';
export { imageSize, type ImageSize } from './imageSize.js';
export { connectionHingeAngle, FlexMove, type FlexState } from './flexMove.js';
