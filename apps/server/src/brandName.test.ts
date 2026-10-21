// The app is called "Collaborative Brick Layout Designer" (Aaron,
// 2026-10-20), on the web and on the desktop. Every name people see says
// so: a source file that says "Brick Layout Designer" without
// "Collaborative " in front fails here. Tests, e2e specs and fixtures are
// left out (they quote old files and the old user agent on purpose), and
// so is the old `BrickLayoutDesigner/x.y` user agent, which has no spaces.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** What people read: the apps' sources, the web's public files, the docs. */
const SCANNED = [
  'apps/web/src',
  'apps/web/public',
  'apps/web/index.html',
  'apps/server/src',
  'packages/bbm/src',
  'packages/model/src',
  'packages/parts-catalog/src',
  'packages/ydoc/src',
  'README.md',
  'SECURITY.md',
  'docs',
  'references',
  '.env.example',
];

/** Files that may keep the old name, and why. */
export const EXCEPTIONS: Record<string, string> = {
  'CHANGELOG.md': 'history is not rewritten',
};

const TEXT = /\.(ts|tsx|js|mjs|json|html|css|md|txt|webmanifest|svg|xml|example)$/;
const SKIPPED_DIR = new Set(['node_modules', 'dist', 'test', 'tests', 'e2e', 'fixtures', '__snapshots__']);
const SKIPPED_FILE = /\.(test|spec)\.(ts|tsx)$/;

// Between the words: spaces, line breaks, a comment's `//`, `*` or `#`, or
// the quotes and `+` of a string split over two lines.
const GAP = String.raw`(?:\s|\/\/|\*|#|[\x60'"+])+`;
const OLD_NAME = new RegExp(String.raw`(?<!Collaborative${GAP})\bBrick${GAP}Layout${GAP}Designer`, 'g');

/** Each place in `files` that names the app without "Collaborative". */
export function oldNames(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of Object.entries(files)) {
    for (const m of text.matchAll(OLD_NAME)) {
      const line = text.slice(0, m.index).split('\n').length;
      const shown = text.split('\n')[line - 1]!.trim().slice(0, 100);
      found.push(`${file}:${line}: ${shown}`);
    }
  }
  return found;
}

function collect(path: string, into: Record<string, string>): void {
  let st;
  try {
    st = statSync(path);
  } catch {
    return; // not in this checkout (e.g. no docs folder yet)
  }
  const rel = relative(ROOT, path).split('\\').join('/');
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (!SKIPPED_DIR.has(name)) collect(join(path, name), into);
    }
    return;
  }
  const name = rel.split('/').pop()!;
  if (!TEXT.test(name) || SKIPPED_FILE.test(name) || name in EXCEPTIONS || rel in EXCEPTIONS) return;
  into[rel] = readFileSync(path, 'utf8');
}

function sources(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const p of SCANNED) collect(join(ROOT, p), files);
  return files;
}

describe('the app name', () => {
  it('is "Collaborative Brick Layout Designer" wherever people read it', () => {
    const files = sources();
    // It really looked: the header, the tours and the emails are in there.
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['apps/web/src/AppHeader.tsx', 'apps/web/src/tours/tours.json', 'apps/server/src/email/sendVerification.ts', 'README.md']),
    );
    expect(oldNames(files)).toEqual([]);
  });

  it('notices the old name, also when it wraps, and lets the new one and the user agent be', () => {
    expect(
      oldNames({
        a: 'Sign in to Brick Layout Designer',
        b: '// made by Brick Layout\n// Designer',
        c: ' * Brick\n * Layout Designer',
        d: 'Welcome to Collaborative Brick Layout Designer!',
        e: '`Collaborative ` +\n// Collaborative\n// Brick Layout Designer',
        f: "'BrickLayoutDesigner/1.3.0 (desktop)'",
        g: 'collaborative-brick-layout-designer',
        j: 'the original BlueBrick Layout Designer plan',
        h: '`a Collaborative ` +\n    `Brick Layout Designer layout`',
        i: "'a Brick ' +\n  'Layout Designer layout'",
      }),
    ).toEqual(['a:1: Sign in to Brick Layout Designer', 'b:1: // made by Brick Layout', 'c:1: * Brick', "i:1: 'a Brick ' +"]);
  });
});
