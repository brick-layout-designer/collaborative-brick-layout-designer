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
