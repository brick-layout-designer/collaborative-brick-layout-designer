// Server-side helper for computing `bbmHashSha256`. Kept separate from
// sidecar.ts so the browser bundle can import sidecar's readers/writers
// without pulling `node:crypto`.

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** Lowercase-hex SHA-256 of the given bytes; matches the desktop format. */
export function hashBbmBytes(bytes: string | Uint8Array): string {
  const h = createHash('sha256');
  h.update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
  return h.digest('hex'); // already lowercase
}
