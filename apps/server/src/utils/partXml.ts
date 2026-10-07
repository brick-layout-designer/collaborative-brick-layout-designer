// Clean-ups applied to a part's XML before the server stores or serves it.

/**
 * Drops the desktop's `<ImportSource>` block from a part's XML. It holds
 * the full path of the model on the importer's computer (and other notes
 * only useful there), which must never be stored on or served by the
 * server. Desktops since #139 strip it before upload; this covers older
 * ones and parts copied from older rows. Plain string search (no regex),
 * so a hostile document can't make it slow.
 */
export function stripImportSource(xmlBlob: Buffer): Buffer {
  const xml = xmlBlob.toString('utf8');
  let out = '';
  let from = 0;
  for (;;) {
    const start = xml.indexOf('<ImportSource', from);
    if (start < 0) break;
    const after = xml.charAt(start + '<ImportSource'.length);
    if (after !== '>' && after !== '/' && !/\s/.test(after)) {
      out += xml.slice(from, start + 1);
      from = start + 1;
      continue;
    }
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd < 0) break;
    let end: number;
    if (xml.charAt(tagEnd - 1) === '/') {
      end = tagEnd + 1;
    } else {
      const close = xml.indexOf('</ImportSource>', tagEnd);
      if (close < 0) break;
      end = close + '</ImportSource>'.length;
    }
    out += xml.slice(from, start);
    from = end;
  }
  if (from === 0) return xmlBlob;
  return Buffer.from(out + xml.slice(from), 'utf8');
}
