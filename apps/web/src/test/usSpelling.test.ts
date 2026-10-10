// US spelling: "color", not "colour" (Aaron, 2026-10-08), anywhere in the
// app's sources: words, comments and names alike.

import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['../**/*.{ts,tsx,json,css,txt}', '!../**/usSpelling.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function britishColour(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => {
      if (/colour/i.test(line)) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return found;
}

describe('US spelling', () => {
  it('says "color", never "colour"', () => {
    expect(britishColour(SOURCES)).toEqual([]);
  });

  it('notices it in any case', () => {
    expect(britishColour({ a: 'Pick a Colour', b: 'paintColour', c: 'COLOURS', d: 'color' })).toHaveLength(3);
  });
});
