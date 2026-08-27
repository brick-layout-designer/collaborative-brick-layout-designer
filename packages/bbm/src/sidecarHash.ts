// Server-side helper for computing `bbmHashSha256`. Kept separate from
// sidecar.ts so the browser bundle can import sidecar's readers/writers
// without pulling `node:crypto`.

import { createHash } from 'node:crypto';

/** Lowercase-hex SHA-256 of the given bytes; matches the desktop format. */
export function hashBbmBytes(bytes: string | Uint8Array): string {
  const h = createHash('sha256');
  // Hash.update() accepts a string directly (encoded as utf8 by default) —
  // no need to go through Buffer, which under TypeScript 7's stricter
  // ArrayBufferLike/SharedArrayBuffer variance no longer satisfies
  // BinaryLike here anyway.
  h.update(bytes);
  return h.digest('hex'); // already lowercase
}
