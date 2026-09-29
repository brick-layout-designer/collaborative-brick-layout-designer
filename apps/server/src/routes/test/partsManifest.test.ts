// Parts manifest (sync P1b): libraries and custom parts with content
// hashes, for the desktop to download only what changed.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { issueToken, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { env } from '../../env.js';
import { passwordRoutes } from '../auth/password.js';
import { deviceRoutes } from '../auth/device.js';
import { customPartRoutes } from '../customParts.js';
import { invalidatePartsCache } from '../parts.js';
import { partsManifestRoutes } from '../partsManifest.js';

const FAKE_GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

describe('parts manifest', () => {
  let app: FastifyInstance;
  let dir: string;
  let saved: string;
  let user: { cookie: string; id: string };

  beforeEach(async () => {
    resetDb();
    dir = mkdtempSync(join(tmpdir(), 'cld-manifest-'));
    mkdirSync(join(dir, 'parts', 'Track'), { recursive: true });
    writeFileSync(join(dir, 'parts', 'Track', '2865.8.xml'), '<part/>');
    writeFileSync(join(dir, 'parts', 'Track', '2865.8.gif'), FAKE_GIF);
    saved = env.partsDir;
    env.partsDir = dir;
    invalidatePartsCache();
    app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(passwordRoutes);
    await app.register(deviceRoutes);
    await app.register(customPartRoutes);
    await app.register(partsManifestRoutes);
    user = await loginAs(app, 'desk@example.com');
  });

  afterEach(async () => {
    await app.close();
    env.partsDir = saved;
    invalidatePartsCache();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

  it('hashes each library file and the library, and follows changes after a reload', async () => {
    const token = await issueToken(app, user.cookie, 'parts:read');
    const auth = { authorization: `Bearer ${token}` };
    const manifest = (await get('/api/parts/manifest', auth)).json() as { libraries: { slug: string; hash: string; fileCount: number; urlPrefix: string }[] };
    expect(manifest.libraries).toHaveLength(1);
    const lib = manifest.libraries[0]!;
    expect(lib).toMatchObject({ slug: 'bluebrickparts', fileCount: 2, urlPrefix: '/parts/' });

    const files = (await get('/api/parts/manifest/libraries/bluebrickparts', auth)).json() as { hash: string; files: { path: string; sha256: string; size: number }[] };
    expect(files.hash).toBe(lib.hash);
    expect(files.files).toEqual([
      { path: 'Track/2865.8.gif', sha256: sha(FAKE_GIF), size: FAKE_GIF.length },
      { path: 'Track/2865.8.xml', sha256: sha('<part/>'), size: 7 },
    ]);
    expect(lib.hash).toBe(sha(files.files.map((f) => `${f.path}:${f.sha256}`).join('\n')));

    // Cached until the parts cache is dropped (Admin → Reload parts).
    writeFileSync(join(dir, 'parts', 'Track', '2865.8.xml'), '<part><Author>x</Author></part>');
    const cached = (await get('/api/parts/manifest', auth)).json() as { libraries: { hash: string }[] };
    expect(cached.libraries[0]!.hash).toBe(lib.hash);
    invalidatePartsCache();
    const fresh = (await get('/api/parts/manifest', auth)).json() as { libraries: { hash: string }[] };
    expect(fresh.libraries[0]!.hash).not.toBe(lib.hash);

    expect((await get('/api/parts/manifest/libraries/nope', auth)).statusCode).toBe(404);
  });

  it("lists the user's custom parts with a hash of their XML and sprite", async () => {
    const up = await app.inject({
      method: 'POST',
      url: '/api/custom-parts',
      headers: { cookie: user.cookie },
      payload: { partNumber: 'MINE', displayName: 'Mine', xmlBase64: Buffer.from('<part/>').toString('base64'), spriteBase64: FAKE_GIF.toString('base64'), spriteMime: 'image/gif' },
    });
    const id = (up.json() as { id: string }).id;
    const res = await get('/api/parts/manifest', { cookie: user.cookie });
    const parts = (res.json() as { customParts: Record<string, unknown>[] }).customParts;
    expect(parts).toEqual([
      expect.objectContaining({
        id,
        partNumber: 'MINE',
        hash: sha(`${sha('<part/>')}\n${sha(FAKE_GIF)}`),
        xmlUrl: `/api/custom-parts/${id}/xml`,
        spriteUrl: `/api/custom-parts/${id}/sprite`,
      }),
    ]);
    // Another user doesn't see it.
    const other = await loginAs(app, 'other@example.com');
    expect(((await get('/api/parts/manifest', { cookie: other.cookie })).json() as { customParts: unknown[] }).customParts).toEqual([]);
  });

  it('needs parts:read on a token', async () => {
    const token = await issueToken(app, user.cookie, 'layouts:read');
    const res = await get('/api/parts/manifest', { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('insufficient_scope');
  });
});
