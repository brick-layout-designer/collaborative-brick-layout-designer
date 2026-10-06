// Parts catalog manifest for the desktop's parts sync (sync phase P1b):
// every library and every custom part the user can see, each with a
// content hash, so the desktop downloads only what is missing or changed.
//
//   GET /api/parts/manifest                  libraries + custom parts, hashed
//   GET /api/parts/manifest/libraries/:slug  one library's files, hashed
//
// Library files download from the public /parts/<urlPrefix><path>;
// custom parts from /api/custom-parts/:id/xml and /sprite (parts:read).
// Library hashes are computed once and cached until the parts cache is
// invalidated (Admin → Reload parts, a library install).

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { onPartsCacheInvalidated, visibleCustomParts } from './parts.js';
import { perPerson } from '../utils/rateLimits.js';

export interface LibraryFile {
  /** Path inside the library, `/`-separated. */
  path: string;
  sha256: string;
  size: number;
}

interface LibraryEntry {
  slug: string;
  name: string;
  /** Public URL prefix the files are served under. */
  urlPrefix: string;
  /** sha256 over the sorted `path:sha256` list; changes when any file does. */
  hash: string;
  fileCount: number;
  files: LibraryFile[];
}

const BASE_SLUG = 'bluebrickparts';

let libraryCache: Promise<LibraryEntry[]> | null = null;

/** Forget the library hashes (the parts cache was invalidated). */
export function invalidateManifestCache(): void {
  libraryCache = null;
}

const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

/** Script files a library may carry for its maintainer (CreatePackage.bat); never part data. */
const SCRIPT_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.exe', '.ps1', '.sh', '.vbs', '.js', '.msi']);

/**
 * Whether a file or folder of a library belongs in the manifest. Hidden
 * entries (.git, .gitignore) and scripts are left out, so the desktop
 * never downloads them.
 */
export function isLibraryContent(name: string): boolean {
  if (name.startsWith('.')) return false;
  const dot = name.lastIndexOf('.');
  return dot < 0 || !SCRIPT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

async function listFiles(root: string): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!isLibraryContent(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const [data, info] = await Promise.all([readFile(full), stat(full)]);
        out.push({ path: relative(root, full).split(sep).join('/'), sha256: sha256(data), size: info.size });
      }
    }
  };
  await walk(root);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function libraryEntry(slug: string, name: string, root: string, urlPrefix: string): Promise<LibraryEntry> {
  const files = await listFiles(root);
  const hash = sha256(files.map((f) => `${f.path}:${f.sha256}`).join('\n'));
  return { slug, name, urlPrefix, hash, fileCount: files.length, files };
}

async function loadLibraries(): Promise<LibraryEntry[]> {
  const out: LibraryEntry[] = [];
  const base = resolve(env.partsDir, 'parts');
  if (existsSync(base)) out.push(await libraryEntry(BASE_SLUG, 'BlueBrickParts', base, '/parts/'));
  const libsDir = resolve(env.partsDir, 'libraries');
  if (existsSync(libsDir)) {
    const installed = await db.select({ slug: schema.partLibraries.slug, name: schema.partLibraries.name }).from(schema.partLibraries).all();
    for (const { slug, name } of installed.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
      if (slug === BASE_SLUG) continue; // served from PARTS_DIR/parts above
      const dir = resolve(libsDir, slug);
      // A slug is a single path component (routes/admin.ts); refuse anything else.
      if (!dir.startsWith(libsDir + sep) || !existsSync(dir)) continue;
      out.push(await libraryEntry(slug, name, dir, `/parts/libraries/${slug}/`));
    }
  }
  return out;
}

function libraries(): Promise<LibraryEntry[]> {
  libraryCache ??= loadLibraries().catch((err) => {
    libraryCache = null;
    throw err;
  });
  return libraryCache;
}

/** Custom part id → { updatedAt, hash of its XML and sprite }. */
const customHashCache = new Map<string, { updatedAt: number; hash: string }>();

async function customPartHashes(ids: readonly { id: string; updatedAt: Date }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const misses = ids.filter((r) => {
    const hit = customHashCache.get(r.id);
    if (hit && hit.updatedAt === r.updatedAt.getTime()) {
      out.set(r.id, hit.hash);
      return false;
    }
    return true;
  });
  for (let i = 0; i < misses.length; i += 200) {
    const batch = misses.slice(i, i + 200);
    const blobs = await db
      .select({ id: schema.customParts.id, xml: schema.customParts.xmlBlob, sprite: schema.customParts.spriteBlob })
      .from(schema.customParts)
      .where(inArray(schema.customParts.id, batch.map((r) => r.id)));
    for (const b of blobs) {
      const hash = sha256(`${sha256(b.xml as Uint8Array)}\n${sha256(b.sprite as Uint8Array)}`);
      out.set(b.id, hash);
      const updatedAt = batch.find((r) => r.id === b.id)!.updatedAt.getTime();
      customHashCache.set(b.id, { updatedAt, hash });
    }
  }
  return out;
}

onPartsCacheInvalidated(invalidateManifestCache);

export async function partsManifestRoutes(app: FastifyInstance): Promise<void> {
  const config = { apiToken: 'parts:read', rateLimit: perPerson(60, '1 minute') } as const;

  app.get('/api/parts/manifest', { config }, async (req) => {
    const libs = await libraries();
    const rows = await visibleCustomParts(req.user?.id ?? null);
    const hashes = await customPartHashes(rows);
    return {
      libraries: libs.map(({ files: _files, ...l }) => l),
      customParts: rows
        .filter((r) => hashes.has(r.id))
        .map((r) => ({
          id: r.id,
          partNumber: r.partNumber,
          displayName: r.displayName,
          ownerOrgId: r.ownerOrgId,
          isGlobal: r.isGlobal,
          hash: hashes.get(r.id)!,
          updatedAt: r.updatedAt.getTime(),
          xmlUrl: `/api/custom-parts/${r.id}/xml`,
          spriteUrl: `/api/custom-parts/${r.id}/sprite`,
        })),
    };
  });

  app.get<{ Params: { slug: string } }>('/api/parts/manifest/libraries/:slug', { config }, async (req, reply) => {
    const lib = (await libraries()).find((l) => l.slug === req.params.slug);
    if (!lib) return reply.code(404).send({ error: 'not_found' });
    return { slug: lib.slug, hash: lib.hash, urlPrefix: lib.urlPrefix, files: lib.files };
  });
}
