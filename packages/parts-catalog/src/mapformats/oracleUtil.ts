// Shared helpers for the map-format oracle tests (port of the desktop
// LDrawMapTest.cpp fixtures): vanilla BlueBrick's own conversions live in
// packages/bbm/tests/fixtures/oracle, and the parts library at
// <repo>/parts-library (tests skip without it).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const PARTS = resolve(ROOT, 'parts-library/parts');
export const ORACLE = resolve(ROOT, 'packages/bbm/tests/fixtures/oracle');

export const oracleText = (name: string) => readFileSync(resolve(ORACLE, name), 'utf8');
export const oracleMap = (name: string): BbmMap => readBbm(oracleText(name)).map;

export interface Key {
  part: string;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  active: number;
}

/** Every kept brick's part, displayArea, orientation and active connection. */
export function bricksOf(map: BbmMap, keep: (partNumber: string) => boolean = () => true): Key[] {
  const out: Key[] = [];
  for (const l of map.layers) {
    if (l.type !== 'brick') continue;
    for (const b of l.bricks) {
      if (!keep(b.partNumber)) continue;
      const a = b.displayArea;
      out.push({ part: b.partNumber.toUpperCase(), x: a.x, y: a.y, w: a.width, h: a.height, angle: b.orientation, active: b.activeConnectionPointIndex });
    }
  }
  return out;
}

const remainder = (a: number, m: number) => a - m * Math.round(a / m);

/**
 * Pairs every brick with an equal one (within 0.01 studs / degrees);
 * describes the leftovers, empty when they all match.
 */
export function unmatched(ours: Key[], theirs: Key[], compareActive = true): string {
  const same = (a: Key, b: Key) =>
    a.part === b.part &&
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01 &&
    Math.abs(remainder(a.angle - b.angle, 360)) < 0.01 &&
    (!compareActive || a.active === b.active);
  const left = [...theirs];
  const mine: Key[] = [];
  for (const k of ours) {
    const i = left.findIndex((t) => same(k, t));
    if (i >= 0) left.splice(i, 1);
    else mine.push(k);
  }
  const text = (k: Key) => `${k.part} (${k.x}, ${k.y}) ${k.w}x${k.h} @${k.angle} active ${k.active}`;
  return [...mine.slice(0, 8).map((k) => `\n  first only:  ${text(k)}`), ...left.slice(0, 8).map((k) => `\n  second only: ${text(k)}`)].join('');
}

const NUMBER = /-?\d+(\.\d+)?(E[-+]\d+)?/g;

/**
 * Compare two texts line by line: equal once numbers are masked, and each
 * number within 1e-3 (relative above 1). Returns the first difference.
 */
export function numericDiff(ours: string[], vanilla: string[]): string {
  if (ours.length !== vanilla.length) return `${ours.length} lines vs ${vanilla.length}`;
  for (let i = 0; i < ours.length; i++) {
    const a = ours[i]!;
    const b = vanilla[i]!;
    if (a.replace(NUMBER, '#') !== b.replace(NUMBER, '#')) return `line ${i}: ${a} vs ${b}`;
    const x = [...a.matchAll(NUMBER)].map((m) => Number(m[0]));
    const y = [...b.matchAll(NUMBER)].map((m) => Number(m[0]));
    for (let j = 0; j < x.length; j++) {
      if (Math.abs(x[j]! - y[j]!) > 1e-3 * Math.max(1, Math.abs(y[j]!))) return `line ${i}: ${a} vs ${b}`;
    }
  }
  return '';
}
