// A custom set's version: which contents a placed copy of it was made
// from, so a layout can say "Update available" once the set changes (its
// parts, where they sit, or its name). Both apps compute the same string
// from a set's parsed XML (the desktop's parts::setVersion, shared vectors
// in setVersion.test.ts), so a copy placed on one is known on the other.
//
//   "set-v1\n" + English name (trimmed) + "\n"
//   + for each sub-part, in order: lower-cased id "|" x "|" y "|" angle "\n"
//
// with each number as floor(v * 1000 + 0.5); the version is the first 16
// hex digits of that text's SHA-256 (UTF-8).
//
// A set holding custom sets also follows theirs, so a change inside one
// shows "Update available" on the set around it too. Its version is
//
//   "set-v2\n" + its own version above + "\n"
//   + for each sub-part that is a custom set, in order:
//     lower-cased id "|" that set's version (this one, so nested ones count) "\n"
//
// digested the same way. A set with no custom set inside keeps its own
// version, so copies placed before this still match.

import { createHash } from 'node:crypto';

export interface SetVersionInput {
  name: string;
  subparts: readonly { subKey: string; x: number; y: number; angle: number }[];
}

const milli = (v: number) => String(Math.floor(v * 1000 + 0.5));

export function setVersionText({ name, subparts }: SetVersionInput): string {
  let text = `set-v1\n${name.trim()}\n`;
  for (const s of subparts) text += `${s.subKey.toLowerCase()}|${milli(s.x)}|${milli(s.y)}|${milli(s.angle)}\n`;
  return text;
}

export function setVersion(input: SetVersionInput): string {
  return createHash('sha256').update(setVersionText(input), 'utf8').digest('hex').slice(0, 16);
}

const digest16 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** A set's version from its own and those of the custom sets inside it (in order); its own when there are none. */
export function nestedSetVersion(own: string, inner: readonly { subKey: string; version: string }[]): string {
  if (inner.length === 0) return own;
  let text = `set-v2\n${own}\n`;
  for (const i of inner) text += `${i.subKey.toLowerCase()}|${i.version}\n`;
  return digest16(text);
}

interface CatalogPart {
  key: string;
  partNumber: string;
  kind: string;
  oldNames?: string[];
  subparts?: readonly { subKey: string }[];
  setVersion?: string;
}

/**
 * The catalog with each custom set's version following the custom sets
 * inside it. A sub-part is found as the editor finds it (indexParts and
 * subpartOf in apps/web/src/editor): by key, then by part number, then by
 * old name, the first one listed winning; never a set it sits in; at most
 * 16 deep. The desktop does the same from its library (edit/SetUpdates.cpp).
 * Changed entries are copies: the parts passed in are left as they are.
 */
export function withNestedSetVersions<P extends CatalogPart>(parts: readonly P[]): P[] {
  const index = new Map<string, P>();
  for (const p of parts) index.set(p.key.toLowerCase(), p);
  for (const p of parts) if (!index.has(p.partNumber.toLowerCase())) index.set(p.partNumber.toLowerCase(), p);
  for (const p of parts) for (const old of p.oldNames ?? []) if (!index.has(old.toLowerCase())) index.set(old.toLowerCase(), p);
  const versionOf = (set: P, outer: readonly P[]): string => {
    const chain = [...outer, set];
    const inner: { subKey: string; version: string }[] = [];
    for (const sp of set.subparts ?? []) {
      const sub = index.get(sp.subKey.toLowerCase());
      if (!sub || sub.kind !== 'group' || !sub.setVersion || chain.includes(sub) || chain.length >= 16) continue;
      inner.push({ subKey: sp.subKey, version: versionOf(sub, chain) });
    }
    return nestedSetVersion(set.setVersion!, inner);
  };
  return parts.map((p) => {
    if (p.kind !== 'group' || !p.setVersion) return p;
    const v = versionOf(p, []);
    return v === p.setVersion ? p : { ...p, setVersion: v };
  });
}
