// The UI says "venue", not "room" (Aaron, 2026-10-01): the redesign had
// renamed it, and it's back. This scans the app's words (not comments or
// identifiers like help keys, the task id or `rooms` counters) for "room".
// The venue designer's rectangle tool really draws a room, so it keeps its name.

import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['../**/*.{ts,tsx,json}', '!../**/*.test.{ts,tsx}', '!../**/test/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// "room" in prose: after a space or an opening quote/bracket, before punctuation or the end.
const LOW = /(?<![A-Za-z.#'"/_-])(?<!more )(?<!no )(?<!leave )(?<!for )rooms?(?=[\s.,’!?)”'"…:<]|$)/;
const CAP = /(?<![A-Za-z.#_-])Rooms?(?![A-Za-z_])/;
/** The designer's rectangle tool and its hint, and the room-shaped model helper. */
const ALLOWED = [/tool: 'room', label: 'Room'/, /A rectangular room/];

export function roomWords(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (ALLOWED.some((a) => a.test(line))) return;
      // Leave out a trailing comment and object keys like `rooms: number` or `room: 'venue'`.
      const words = line.replace(/\s\/\/.*$/, '').replace(/\brooms?:\s*(number|'|\d)/g, '');
      if (LOW.test(words) || CAP.test(words)) found.push(`${file}:${i + 1}: ${t.slice(0, 100)}`);
    });
  }
  return found;
}

describe('venue wording', () => {
  it('the UI never calls the venue a room', () => {
    expect(roomWords(SOURCES)).toEqual([]);
  });

  it('notices "room" in labels, sentences and quoted words', () => {
    expect(roomWords({ a: "  { id: 'x', label: 'Room library' }" })).toHaveLength(1);
    expect(roomWords({ a: '<h2>Rooms</h2>' })).toHaveLength(1);
    expect(roomWords({ a: "fail('delete the room')" })).toHaveLength(1);
    expect(roomWords({ a: "short: 'the room’s plan'" })).toHaveLength(1);
    // Not identifiers, help keys, counters, idioms or comments.
    expect(roomWords({ a: "helpKey=\"room.units\" t === 'room' r.rooms ask for more room // the room" })).toEqual([]);
  });
});
