// BlueBrick budget files (.bbb) — port of desktop edit/Budget.cpp
// readBudgetFile / writeBudgetFile. `<Budget><Version>1</Version>
// <BudgetEntry><PartNumber/><Limit/></BudgetEntry>…</Budget>`.

export interface BudgetEntry {
  part: string;
  /** Maximum allowed count; negative = unlimited (never written). */
  limit: number;
}

/**
 * Parse a .bbb. Like desktop, entries without a part number or with a
 * negative / missing limit are dropped ("unlimited" is the absence of an
 * entry).
 */
export function parseBbb(xml: string): BudgetEntry[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const entries: BudgetEntry[] = [];
  for (const el of Array.from(doc.querySelectorAll('BudgetEntry'))) {
    const part = el.querySelector('PartNumber')?.textContent?.trim() ?? '';
    const limit = parseInt(el.querySelector('Limit')?.textContent?.trim() ?? '', 10);
    if (part && Number.isFinite(limit) && limit >= 0) entries.push({ part, limit });
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

/**
 * Serialise like QXmlStreamWriter with 2-space auto-formatting: text is
 * escaped, entries sorted by part number (code-unit order, as
 * QStringList::sort), unlimited (negative) entries omitted.
 */
export function writeBbb(entries: BudgetEntry[]): string {
  const kept = entries.filter((e) => e.part && e.limit >= 0);
  kept.sort((a, b) => (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
  const rows = kept.map(
    (e) =>
      `  <BudgetEntry>\n    <PartNumber>${escapeXml(e.part)}</PartNumber>\n    <Limit>${Math.trunc(e.limit)}</Limit>\n  </BudgetEntry>\n`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Budget>\n  <Version>1</Version>\n${rows.join('')}</Budget>\n`;
}
