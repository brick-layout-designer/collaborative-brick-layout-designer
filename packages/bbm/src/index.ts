// `.bbm` (XML) reader/writer + `.bbm.cld` sidecar (JSON) reader/writer.
//
// Phase 2 port from desktop CLD's `src/saveload/`. Round-trip parity with
// the desktop is enforced by the byte-exact + semantic tests against the
// vendored sample `.bbm` files in `tests/fixtures/`.

export { readBbm, type ReadResult } from './Reader.js';
export { writeBbm, type WriteOptions } from './Writer.js';
export { vanillaPostProcess } from './xml.js';
export { formatBool, formatInt, formatNumber, parseBool } from './format.js';
export {
  CURRENT_SCHEMA_VERSION,
  readSidecar,
  writeSidecar,
  type AnchoredLabel,
  type BackgroundImage,
  type Sidecar,
  type SidecarModule,
  type Venue,
  type VenueEdge,
  type VenueObstacle,
  type WriteSidecarOptions,
} from './sidecar.js';
// `hashBbmBytes` lives at `@cld/bbm/hash` because it imports `node:crypto`.
// Browser callers MUST NOT import that subpath; server routes do so
// explicitly. See sidecarHash.ts for the rationale.
export { BBM_FORMAT_VERSION } from '@cld/model';
