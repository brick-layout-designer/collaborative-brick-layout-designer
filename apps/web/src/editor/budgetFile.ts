// BlueBrick budget files (.bbb) — port of desktop edit/Budget.cpp, byte
// for byte what vanilla BlueBrick's XmlSerializer writes:
//
//   <?xml version="1.0" encoding="utf-8"?>
//   <Budget>
//     <Version>1</Version>
//     <PartList>
//       <Part id="2865.8">12</Part>
//     </PartList>
//   </Budget>
//
// CRLF line ends, no trailing newline, entries in file order, and
// `<PartList />` when empty. Part ids are case-insensitive.

export interface BudgetEntry {
  part: string;
  /** Maximum allowed count; negative = unlimited (never written). */
  limit: number;
}

/**
 * Parse a .bbb, keeping file order. Like BlueBrick, a value that isn't an
 * integer or a Part without an id rejects the whole file (throws), and a
 * repeated id (in any case) keeps its first value. Files written by
 * earlier web builds (`<BudgetEntry><PartNumber/><Limit/>`) still load.
 */
export function parseBbb(xml: string): BudgetEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.nodeName !== 'Budget' || doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('not a BlueBrick budget file');
  }
  const entries: BudgetEntry[] = [];
  const seen = new Set<string>();
  const add = (part: string, limit: number) => {
    const key = part.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ part, limit });
  };

  for (const list of Array.from(root.children).filter((c) => c.nodeName === 'PartList')) {
    for (const el of Array.from(list.children).filter((c) => c.nodeName === 'Part')) {
      const part = el.getAttribute('id') ?? '';
      const text = (el.textContent ?? '').trim();
      if (!part || !/^[+-]?\d+$/.test(text)) throw new Error(`invalid budget entry for part "${part}"`);
      add(part, Number(text));
    }
  }

  // Legacy web format.
  for (const el of Array.from(root.children).filter((c) => c.nodeName === 'BudgetEntry')) {
    const part = el.querySelector('PartNumber')?.textContent?.trim() ?? '';
    const limit = parseInt(el.querySelector('Limit')?.textContent?.trim() ?? '', 10);
    if (part && Number.isFinite(limit)) add(part, limit);
  }
  return entries;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Serialise like BlueBrick (Budget.cpp write): file order kept, unlimited (negative) entries omitted. */
export function writeBbb(entries: readonly BudgetEntry[]): string {
  const nl = '\r\n';
  const kept = entries.filter((e) => e.part && e.limit >= 0);
  let out = `<?xml version="1.0" encoding="utf-8"?>${nl}<Budget>${nl}  <Version>1</Version>${nl}`;
  if (kept.length === 0) {
    out += `  <PartList />${nl}`;
  } else {
    out += `  <PartList>${nl}`;
    for (const e of kept) out += `    <Part id="${escapeXml(e.part)}">${Math.trunc(e.limit)}</Part>${nl}`;
    out += `  </PartList>${nl}`;
  }
  return `${out}</Budget>`;
}

/**
 * Add `incoming`'s limits to `current` (desktop Budget::mergeWith): a new
 * part is appended; a part already budgeted (ids match case-insensitively)
 * gets the sum of both limits, keeps its spelling and moves to the end, as
 * BlueBrick removes and re-adds it.
 */
export function mergeBudgets(current: readonly BudgetEntry[], incoming: readonly BudgetEntry[]): BudgetEntry[] {
  const out = current.map((e) => ({ ...e }));
  for (const e of incoming) {
    const i = out.findIndex((c) => c.part.toUpperCase() === e.part.toUpperCase());
    if (i < 0) {
      out.push({ ...e });
    } else {
      const [kept] = out.splice(i, 1);
      out.push({ part: kept!.part, limit: kept!.limit + e.limit });
    }
  }
  return out;
}
