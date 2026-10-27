// Parts only used inside sets: BlueBrick's <NotListedInLibrary>true (a
// building of a castle set, a cut track piece, a flex half). The Parts
// panel leaves them out unless "Show hidden parts" is ticked or their set
// is opened ("Show its parts"), and never places one by itself; placing,
// moving or ungrouping the set is as before. The desktop does the same.

import { useCallback, useState } from 'react';
import type { PartWire } from '../api';
import { subpartOf } from './sets';

type Parts = ReadonlyMap<string, PartWire>;

const SHOW_HIDDEN_KEY = 'cld.parts.showHidden';

/** "Show hidden parts", remembered in this browser. */
export function useShowHiddenParts(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SHOW_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(SHOW_HIDDEN_KEY, '1');
      else localStorage.removeItem(SHOW_HIDDEN_KEY);
    } catch {
      /* not remembered: still on for now */
    }
  }, []);
  return [on, set];
}

/** The parts (and sets) inside `set`, a set inside it opened too, by catalog key. */
export function partsInSet(parts: Parts, set: PartWire): Set<string> {
  const out = new Set<string>();
  const visit = (s: PartWire, outer: readonly PartWire[]) => {
    const inside = [...outer, s];
    for (const sp of s.subparts) {
      const p = subpartOf(parts, sp.subKey, inside);
      if (!p || out.has(p.key)) continue;
      out.add(p.key);
      if (p.kind === 'group' && inside.length < 16) visit(p, inside);
    }
  };
  if (set.kind === 'group') visit(set, []);
  return out;
}

/** Why a part only used inside sets isn't placed by itself. */
export function hiddenPartNotice(part: PartWire): string {
  const name = part.description || part.partNumber;
  return `“${name}” is only used inside a set, so it isn’t placed by itself. Place its set instead.`;
}
