// Integration tests for /api/admin/global-parts and /api/admin/audit.
// Covers branches not hit by admin.test.ts.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bufConcat, bufCopy, db, resetDb, schema } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';
import { orgRoutes } from '../orgs.js';
import { adminRoutes } from '../admin.js';
import { inviteRoutes } from '../invites.js';

const SAMPLE_XML = Buffer.from(
  `<?xml version="1.0"?><part><Author>Test</Author></part>`,
).toString('base64');
const FAKE_GIF = Buffer.from(
  'GIF89a\x01\x00\x01\x00\x00\xff\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x00;',
).toString('base64');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  await app.register(orgRoutes);
  await app.register(inviteRoutes);
  await app.register(adminRoutes);
  return app;
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const user = await db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  const verification = await db
    .select()
    .from(schema.emailVerifications)
    .where(eq(schema.emailVerifications.userId, user!.id))
    .get();
  const verifyRes = await app.inject({
    method: 'POST',
    url: `/api/auth/password/verify-email/${verification!.token}`,
  });
  expect(verifyRes.statusCode).toBe(200);
  const setCookie = verifyRes.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

async function promoteToAdmin(email: string): Promise<void> {
  await db.update(schema.users).set({ isGlobalAdmin: true }).where(eq(schema.users.email, email));
}

// ---------------------------------------------------------------------------
// Global parts CRUD
// ---------------------------------------------------------------------------

describe('admin global-parts', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET /api/admin/global-parts returns empty list initially', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({ method: 'GET', url: '/api/admin/global-parts', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { parts: unknown[] }).parts).toHaveLength(0);
  });

  it('POST creates a global part and GET returns it', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'GLOBAL_001',
        displayName: 'Global Test Part',
        category: 'Test',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    expect(create.statusCode).toBe(201);
    const { id } = create.json() as { id: string };
    expect(typeof id).toBe('string');

    const list = await app.inject({ method: 'GET', url: '/api/admin/global-parts', headers: { cookie } });
    const { parts } = list.json() as { parts: { partNumber: string }[] };
    expect(parts.some((p) => p.partNumber === 'GLOBAL_001')).toBe(true);
  });

  it('POST returns 400 when partNumber or displayName is missing', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: { displayName: 'No PartNum', xmlBase64: SAMPLE_XML, spriteBase64: FAKE_GIF, spriteMime: 'image/gif' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_input');
  });

  it('POST returns 400 for invalid spriteMime', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'P1',
        displayName: 'P1',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/jpeg',
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_sprite_mime');
  });

  it('POST returns 400 for invalid part XML', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const badXml = Buffer.from('not valid xml at all !!!').toString('base64');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'BAD',
        displayName: 'Bad',
        xmlBase64: badXml,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_part_xml');
  });

  it('DELETE removes a global part', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'TO_DELETE',
        displayName: 'Delete Me',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    const { id } = create.json() as { id: string };

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/global-parts/${id}`, headers: { cookie } });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/admin/global-parts', headers: { cookie } });
    const { parts } = list.json() as { parts: { partNumber: string }[] };
    expect(parts.some((p) => p.partNumber === 'TO_DELETE')).toBe(false);
  });

  it('DELETE returns 404 for non-existent part', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({ method: 'DELETE', url: '/api/admin/global-parts/no-such-id', headers: { cookie } });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE returns 403 when trying to delete a non-global part', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Create a user-owned custom part (isGlobal=false) directly.
    const adminId = (await db.select().from(schema.users).where(eq(schema.users.email, 'admin@example.com')).get())!.id;
    const now = new Date();
    await db.insert(schema.customParts).values({
      id: 'user-part-id',
      partNumber: 'USER_001',
      displayName: 'User Part',
      category: 'Custom',
      isGlobal: false,
      ownerUserId: adminId,
      ownerOrgId: null,
      createdBy: adminId,
      xmlBlob: Buffer.from('<part/>'),
      spriteBlob: Buffer.from(FAKE_GIF, 'base64'),
      spriteMime: 'image/gif',
      createdAt: now,
      updatedAt: now,
    });

    const res = await app.inject({ method: 'DELETE', url: '/api/admin/global-parts/user-part-id', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('POST returns 403 for a non-admin user', async () => {
    const cookie = await registerAndLogin(app, 'regular@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'P',
        displayName: 'P',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Admin audit log
// ---------------------------------------------------------------------------

describe('admin audit log', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns an events array (may be empty)', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { events: unknown[]; total: number; limit: number; offset: number };
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.offset).toBe('number');
  });

  it('records audit events from admin mutations (global part create/delete)', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Create a global part → generates audit event.
    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'AUDIT_PART',
        displayName: 'Audit Part',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });
    expect(create.statusCode).toBe(201);

    const auditRes = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
    const { events } = auditRes.json() as { events: Array<{ eventType: string }> };
    expect(events.some((e) => e.eventType === 'admin_global_part_create')).toBe(true);
  });

  it('respects limit and offset', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Generate a few audit events via layout invites.
    const layoutRes = await app.inject({
      method: 'POST', url: '/api/layouts', headers: { cookie }, payload: { title: 'L' },
    });
    const layoutId = (layoutRes.json() as { id: string }).id;

    for (const email of ['a@e.com', 'b@e.com', 'c@e.com']) {
      await app.inject({
        method: 'POST',
        url: `/api/layouts/${layoutId}/invites`,
        headers: { cookie },
        payload: { email, role: 'viewer' },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit?limit=2&offset=0', headers: { cookie } });
    const body = res.json() as { events: unknown[]; limit: number; offset: number };
    expect(body.events.length).toBeLessThanOrEqual(2);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it('includes userName field for events with a userId', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Create a global part — this writes an audit event with the admin's userId.
    await app.inject({
      method: 'POST',
      url: '/api/admin/global-parts',
      headers: { cookie },
      payload: {
        partNumber: 'AUDIT_USER',
        displayName: 'Audit User Part',
        xmlBase64: SAMPLE_XML,
        spriteBase64: FAKE_GIF,
        spriteMime: 'image/gif',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
    const { events } = res.json() as { events: Array<{ userName: string | null }> };
    expect(events.length).toBeGreaterThan(0);
    // The admin user's name should be set.
    expect(events.some((e) => e.userName !== null)).toBe(true);
  });

  it('returns 403 for a non-admin user', async () => {
    const cookie = await registerAndLogin(app, 'regular@example.com');
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Admin part-libraries
// ---------------------------------------------------------------------------

describe('admin part-libraries', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET /api/admin/part-libraries returns an empty list', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({ method: 'GET', url: '/api/admin/part-libraries', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const { libraries } = res.json() as { libraries: unknown[] };
    expect(Array.isArray(libraries)).toBe(true);
  });

  it('GET /api/admin/reload-parts returns ok=true', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({ method: 'POST', url: '/api/admin/reload-parts', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });

  it('POST /api/admin/part-libraries returns 400 when name/slug missing', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/part-libraries',
      headers: { cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/admin/part-libraries/install-base returns 409 when already installed', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Insert a dummy row so the route thinks it's already installed.
    const adminId = (await db.select().from(schema.users).where(eq(schema.users.email, 'admin@example.com')).get())!.id;
    const now = new Date();
    await db.insert(schema.partLibraries).values({
      id: 'base-lib-id',
      name: 'BlueBrickParts (base library)',
      slug: 'bluebrickparts',
      sourceUrl: null,
      partCount: 0,
      defaultEnabled: true,
      locked: true,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/part-libraries/install-base',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('already_installed');
  });

  it('PATCH /api/admin/part-libraries/:id returns 404 for unknown id', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/part-libraries/no-such',
      headers: { cookie },
      payload: { defaultEnabled: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/admin/part-libraries/:id updates fields on existing library', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const now = new Date();
    const libId = 'patch-test-lib';
    await db.insert(schema.partLibraries).values({
      id: libId,
      name: 'Patch Target',
      slug: 'patch-target',
      partCount: 5,
      defaultEnabled: false,
      locked: false,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/part-libraries/${libId}`,
      headers: { cookie },
      payload: { defaultEnabled: true, name: 'Patched Library' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    const updated = await db.select().from(schema.partLibraries).where(eq(schema.partLibraries.id, libId)).get();
    expect(updated!.defaultEnabled).toBe(true);
    expect(updated!.name).toBe('Patched Library');
  });

  it('DELETE /api/admin/part-libraries/:id removes a library (dir may not exist on disk)', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const now = new Date();
    const libId = 'delete-lib-id';
    await db.insert(schema.partLibraries).values({
      id: libId,
      name: 'To Delete',
      slug: 'to-delete',
      partCount: 0,
      defaultEnabled: false,
      locked: false,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/part-libraries/${libId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);

    const after = await db.select().from(schema.partLibraries).where(eq(schema.partLibraries.id, libId)).get();
    expect(after).toBeUndefined();
  });

  it('DELETE /api/admin/part-libraries/:id returns 404 for unknown id', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/part-libraries/no-such-lib',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/admin/part-libraries/:id returns 500 when slug is corrupt', async () => {
    const cookie = await registerAndLogin(app, 'admin@example.com');
    await promoteToAdmin('admin@example.com');

    // Insert a library with a slug that fails the /^([a-z0-9-]+)$/ check.
    const now = new Date();
    const libId = 'corrupt-slug-lib';
    await db.insert(schema.partLibraries).values({
      id: libId,
      name: 'Corrupt Slug',
      slug: 'UPPERCASE_INVALID',
      partCount: 0,
      defaultEnabled: false,
      locked: false,
      installedAt: now,
      updatedAt: now,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/part-libraries/${libId}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toBe('corrupt_slug');
  });
});

// ---------------------------------------------------------------------------
// syncLibrariesFromDisk
// ---------------------------------------------------------------------------

import { mkdtemp, mkdir, writeFile, rm as rmFs, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncLibrariesFromDisk, detectTopLevelPrefix, extractZip } from '../admin.js';
import { deflateRawSync } from 'node:zlib';

describe('syncLibrariesFromDisk', () => {
  beforeEach(() => { resetDb(); });

  it('does nothing when the libraries directory does not exist', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const before = (await db.select().from(schema.partLibraries)).length;
    try {
      await syncLibrariesFromDisk(tmpRoot);
      // No libraries dir → no new rows.
      const after = (await db.select().from(schema.partLibraries)).length;
      expect(after).toBe(before);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });

  it('auto-registers a library directory that has XML files', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    try {
      const libDir = join(tmpRoot, 'libraries', 'my-lib');
      await mkdir(libDir, { recursive: true });
      await writeFile(join(libDir, 'part1.xml'), '<part/>');
      await writeFile(join(libDir, 'part2.xml'), '<part/>');

      await syncLibrariesFromDisk(tmpRoot);

      const libs = await db.select().from(schema.partLibraries);
      expect(libs.some((l) => l.slug === 'my-lib')).toBe(true);
      const lib = libs.find((l) => l.slug === 'my-lib')!;
      expect(lib.partCount).toBe(2);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });

  it('skips a library directory with no XML files', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    try {
      const libDir = join(tmpRoot, 'libraries', 'empty-lib');
      await mkdir(libDir, { recursive: true });
      await writeFile(join(libDir, 'readme.txt'), 'no xml here');

      await syncLibrariesFromDisk(tmpRoot);

      const libs = await db.select().from(schema.partLibraries);
      expect(libs.some((l) => l.slug === 'empty-lib')).toBe(false);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });

  it('skips libraries already registered in DB', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    try {
      const libDir = join(tmpRoot, 'libraries', 'already-there');
      await mkdir(libDir, { recursive: true });
      await writeFile(join(libDir, 'a.xml'), '<part/>');

      // Pre-register so slug is already known.
      const now = new Date();
      await db.insert(schema.partLibraries).values({
        id: 'pre-existing-id',
        name: 'Already There',
        slug: 'already-there',
        partCount: 0,
        defaultEnabled: false,
        locked: false,
        installedAt: now,
        updatedAt: now,
      });

      await syncLibrariesFromDisk(tmpRoot);

      // Should still be exactly one entry, not duplicated.
      const libs = await db.select().from(schema.partLibraries).where(eq(schema.partLibraries.slug, 'already-there'));
      expect(libs).toHaveLength(1);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });

  it('logs auto-registered libraries when logger is provided', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const messages: string[] = [];
    try {
      const libDir = join(tmpRoot, 'libraries', 'logged-lib');
      await mkdir(libDir, { recursive: true });
      await writeFile(join(libDir, 'x.xml'), '<part/>');

      await syncLibrariesFromDisk(tmpRoot, { info: (msg) => messages.push(msg) });

      expect(messages.some((m) => m.includes('logged-lib'))).toBe(true);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });

  it('returns early when libraries path is a file (readdir throws)', async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sync-test-'));
    const before = (await db.select().from(schema.partLibraries)).length;
    try {
      // Create 'libraries' as a regular file, not a directory.
      await mkdir(tmpRoot, { recursive: true });
      await writeFile(join(tmpRoot, 'libraries'), 'not a dir');

      // Should not throw — error is caught internally.
      await syncLibrariesFromDisk(tmpRoot);

      // Nothing new should have been inserted.
      const after = (await db.select().from(schema.partLibraries)).length;
      expect(after).toBe(before);
    } finally {
      await rmFs(tmpRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// detectTopLevelPrefix
// ---------------------------------------------------------------------------

describe('detectTopLevelPrefix', () => {
  it('returns empty string for empty input', () => {
    expect(detectTopLevelPrefix([])).toBe('');
  });

  it('returns empty string when first name has no slash prefix', () => {
    expect(detectTopLevelPrefix(['file.txt', 'other.txt'])).toBe('');
  });

  it('detects a common top-level prefix', () => {
    expect(detectTopLevelPrefix(['repo-main/a.xml', 'repo-main/b.xml'])).toBe('repo-main/');
  });

  it('returns empty string when not all names share the prefix', () => {
    expect(detectTopLevelPrefix(['repo-main/a.xml', 'other/b.xml'])).toBe('');
  });

  it('handles a single file with a directory prefix', () => {
    expect(detectTopLevelPrefix(['repo-main/only.xml'])).toBe('repo-main/');
  });
});

// ---------------------------------------------------------------------------
// extractZip — stored (method=0) entries
// ---------------------------------------------------------------------------

function buildStoredZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const offset = parts.reduce((sum, p) => sum + p.length, 0);

    // Local file header.
    const lh = Buffer.alloc(30 + nameBytes.length);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4);          // version needed
    lh.writeUInt16LE(0, 6);           // flags
    lh.writeUInt16LE(0, 8);           // method = stored
    lh.writeUInt16LE(0, 10);          // mod time
    lh.writeUInt16LE(0, 12);          // mod date
    lh.writeUInt32LE(0, 14);          // crc (ignored in test)
    lh.writeUInt32LE(file.data.length, 18); // compressed size
    lh.writeUInt32LE(file.data.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);          // extra len
    bufCopy(nameBytes, lh, 30);
    parts.push(lh, file.data);

    // Central directory entry.
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0); // signature
    cd.writeUInt16LE(20, 4);          // version made
    cd.writeUInt16LE(20, 6);          // version needed
    cd.writeUInt16LE(0, 8);           // flags
    cd.writeUInt16LE(0, 10);          // method = stored
    cd.writeUInt16LE(0, 12);          // mod time
    cd.writeUInt16LE(0, 14);          // mod date
    cd.writeUInt32LE(0, 16);          // crc
    cd.writeUInt32LE(file.data.length, 20);
    cd.writeUInt32LE(file.data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    bufCopy(nameBytes, cd, 46);
    centralDir.push(cd);
  }

  const cdBuf = bufConcat(centralDir);
  const cdOffset = parts.reduce((sum, p) => sum + p.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralDir.length, 8);
  eocd.writeUInt16LE(centralDir.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return bufConcat([...parts, cdBuf, eocd]);
}

describe('extractZip', () => {
  it('extracts stored-entry zip files to destDir', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const content = Buffer.from('hello world');
      const zipBuf = buildStoredZip([{ name: 'test.txt', data: content }]);

      await extractZip(zipBuf, tmpDir);

      const extracted = await readFile(join(tmpDir, 'test.txt'));
      expect(extracted.toString()).toBe('hello world');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('strips a common top-level prefix from entry names', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const content = Buffer.from('prefixed file');
      const zipBuf = buildStoredZip([{ name: 'repo-main/a.txt', data: content }]);

      await extractZip(zipBuf, tmpDir);

      const extracted = await readFile(join(tmpDir, 'a.txt'));
      expect(extracted.toString()).toBe('prefixed file');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts files in nested directories (prefix stripped)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const content = Buffer.from('nested');
      // Two files with same prefix — prefix is not stripped if only one file.
      // Use two files sharing a common parent to avoid auto-prefix-stripping.
      const zipBuf = buildStoredZip([
        { name: 'pkg/subdir/a.txt', data: content },
        { name: 'pkg/subdir/b.txt', data: Buffer.from('b') },
      ]);

      await extractZip(zipBuf, tmpDir);

      // 'pkg/' is the common prefix → stripped to 'subdir/a.txt'.
      const extracted = await readFile(join(tmpDir, 'subdir/a.txt'));
      expect(extracted.toString()).toBe('nested');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips directory entries (names ending with /)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const dirEntry = Buffer.alloc(0);
      const fileEntry = Buffer.from('real file');
      const zipBuf = buildStoredZip([
        { name: 'mydir/', data: dirEntry },
        { name: 'real.txt', data: fileEntry },
      ]);

      await extractZip(zipBuf, tmpDir);

      // mydir/ should not be created as a file.
      const extracted = await readFile(join(tmpDir, 'real.txt'));
      expect(extracted.toString()).toBe('real file');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws on ZIP slip attempt', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const content = Buffer.from('evil');
      const zipBuf = buildStoredZip([{ name: '../../../etc/passwd', data: content }]);

      await expect(extractZip(zipBuf, tmpDir)).rejects.toThrow('ZIP slip');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts a deflate-compressed (method=8) entry', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const original = Buffer.from('hello deflated world');
      const compressed = deflateRawSync(new Uint8Array(original));

      const nameBytes = Buffer.from('deflated.txt', 'utf8');
      const lh = Buffer.alloc(30 + nameBytes.length);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(8, 8);          // method = deflate
      lh.writeUInt16LE(0, 10);
      lh.writeUInt16LE(0, 12);
      lh.writeUInt32LE(0, 14);
      lh.writeUInt32LE(compressed.length, 18);
      lh.writeUInt32LE(original.length, 22);
      lh.writeUInt16LE(nameBytes.length, 26);
      lh.writeUInt16LE(0, 28);
      bufCopy(nameBytes, lh, 30);

      const zipBuf = bufConcat([lh, compressed]);

      await extractZip(zipBuf, tmpDir);

      const extracted = await readFile(join(tmpDir, 'deflated.txt'));
      expect(extracted.toString()).toBe('hello deflated world');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws on unsupported compression method', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'zip-test-'));
    try {
      const nameBytes = Buffer.from('weird.txt', 'utf8');
      const lh = Buffer.alloc(30 + nameBytes.length);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(99, 8);         // method = 99 (unsupported)
      lh.writeUInt16LE(0, 10);
      lh.writeUInt16LE(0, 12);
      lh.writeUInt32LE(0, 14);
      lh.writeUInt32LE(4, 18);         // 4 bytes compressed
      lh.writeUInt32LE(4, 22);
      lh.writeUInt16LE(nameBytes.length, 26);
      lh.writeUInt16LE(0, 28);
      bufCopy(nameBytes, lh, 30);

      const data = Buffer.from('data');
      const zipBuf = bufConcat([lh, data]);

      await expect(extractZip(zipBuf, tmpDir)).rejects.toThrow('unsupported compression method 99');
    } finally {
      await rmFs(tmpDir, { recursive: true, force: true });
    }
  });
});
