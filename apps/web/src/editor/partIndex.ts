// Catalog index shared by the editor: lower-cased catalog key, then the
// bare part number for entries without a color code, then old part
// numbers (<OldNameList>, desktop PartsLibrary canonicalKey). Earlier
// entries win, so an old name never shadows a real part.

import type { PartWire } from '../api';

export function indexParts(parts: readonly PartWire[] | undefined): Map<string, PartWire> {
  const m = new Map<string, PartWire>();
  if (!parts) return m;
  for (const p of parts) m.set(p.key.toLowerCase(), p);
  for (const p of parts) {
    const bare = p.partNumber.toLowerCase();
    if (!m.has(bare)) m.set(bare, p);
  }
  for (const p of parts) {
    for (const old of p.oldNames ?? []) {
      const k = old.toLowerCase();
      if (!m.has(k)) m.set(k, p);
    }
  }
  return m;
}

/**
 * The current id for a part id that may be an old name: the replacing
 * part's `PARTNUMBER.COLOR` upper-cased, like BlueBrick's
 * getActualPartNumber (Budget.cpp actualPartNumber). Anything else is
 * returned as is.
 */
export function actualPartNumber(index: ReadonlyMap<string, PartWire>, id: string): string {
  const k = id.toLowerCase();
  const p = index.get(k);
  if (!p || p.key.toLowerCase() === k) return id;
  // Only a listed old name converts; a bare part number stays as written.
  if (!(p.oldNames ?? []).some((o) => o.toLowerCase() === k)) return id;
  return (p.colorCode ? `${p.partNumber}.${p.colorCode}` : p.partNumber).toUpperCase();
}
