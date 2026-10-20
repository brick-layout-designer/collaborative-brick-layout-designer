// `Content-Disposition: attachment` for a file named after something a
// person typed (a layout's title). A header may only carry Latin-1, and
// Node refuses anything else with a 500, so a layout called "東京" or
// "Train 🚂" could not be downloaded. The name goes in `filename*` (RFC
// 6266/5987, UTF-8, percent-encoded), which browsers use, with a plain
// ASCII `filename` beside it for anything older.

// eslint-disable-next-line no-control-regex -- control characters are what this strips
const UNSAFE = /[\\/:*?"<>|\x00-\x1F\x7F]+/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** A file name made from a title: no path or control characters, at most 80 long, never empty. */
export function safeFileName(title: string, fallback = 'layout'): string {
  const cleaned = title.replace(LONE_SURROGATE, '').replace(UNSAFE, '_').trim();
  return cleaned.length > 0 ? Array.from(cleaned).slice(0, 80).join('') : fallback;
}

/** The header value for downloading `name` (already a safe file name, extension included). */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(name.replace(LONE_SURROGATE, '')).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
