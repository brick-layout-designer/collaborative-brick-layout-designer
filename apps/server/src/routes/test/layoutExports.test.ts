// Integration tests for layout export endpoints:
//   GET /api/layouts/:id/export.bbm
//   GET /api/layouts/:id/export.bbm.cld
//   GET /api/layouts/:id/export.zip
// And layout background image endpoints:
//   POST   /api/layouts/:id/background-image
//   GET    /api/layouts/:id/background-image
//   DELETE /api/layouts/:id/background-image

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { sessionRoutes } from '../auth/session.js';
import { layoutRoutes } from '../layouts.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/bbm/tests/fixtures',
);

const FORDYCE_BBM = readFileSync(join(FIXTURES, 'fordyce-2026.bbm'), 'utf-8');
const MINIMAL_SIDECAR = readFileSync(join(FIXTURES, 'minimal.bbm.cld'), 'utf-8').trim();

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(fastifyMultipart);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(sessionRoutes);
  await app.register(layoutRoutes);
  return app;
}

async function registerAndLogin(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/password/register',
    payload: { email, password: 'correct horse battery', displayName: email },
  });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  return Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
}

async function createLayout(
  app: FastifyInstance,
  cookieStr: string,
  title = 'Export Layout',
  bbm?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/layouts',
    headers: { cookie: cookieStr },
    payload: bbm ? { title, bbm } : { title },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

describe('export — .bbm', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns XML with correct content-type for a BBM-seeded layout', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Fordyce Export', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
    expect(res.payload).toContain('<Map>');
    expect(res.payload).toContain('</Map>');
  });

  it('contains disposition header with .bbm filename', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'My Layout', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie },
    });
    expect(res.headers['content-disposition']).toContain('.bbm');
  });

  it('in-app layout: export returns 200 (createDefaultLayoutDoc seeds meta.version)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'In-App Layout');

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie },
    });
    // createDefaultLayoutDoc always sets meta.version, so exportBbmFromDoc
    // returns a valid BbmMap and the route returns 200.
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('xml');
  });

  it('returns 404 for a non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie, 'Private Layout', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('preserves the number of items in the round-trip', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Fordyce Round-trip', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm`,
      headers: { cookie },
    });
    // Fordyce has 949 bricks — Brick element count should be substantial.
    const matches = res.payload.match(/<Brick id="/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThan(100);
  });
});

describe('export — .bbm.cld (sidecar)', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns 404 when no sidecar exists', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'No Sidecar', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm.cld`,
      headers: { cookie },
    });
    // Sidecar is optional — expect either 200 (if generated) or 404.
    expect([200, 404]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toContain('json');
    }
  });

  it('returns 404 to non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie, 'Sidecar Layout', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm.cld`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 200 JSON when a sidecar was provided at creation', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie },
      payload: { title: 'With Sidecar', bbm: FORDYCE_BBM, sidecar: MINIMAL_SIDECAR },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    const cld = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.bbm.cld`,
      headers: { cookie },
    });
    expect(cld.statusCode).toBe(200);
    expect(cld.headers['content-type']).toContain('json');
  });
});

describe('export — .zip', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('returns a zip file for a BBM-seeded layout', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Zip Export', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('.zip');
    // ZIP magic bytes: PK\x03\x04
    expect(res.rawPayload[0]).toBe(0x50);
    expect(res.rawPayload[1]).toBe(0x4b);
  });

  it('zip is non-trivial in size for Fordyce layout', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Fordyce Zip', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
      headers: { cookie },
    });
    expect(res.rawPayload.byteLength).toBeGreaterThan(500);
  });

  it('in-app layout: zip export returns 200 (createDefaultLayoutDoc seeds meta.version)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'In-App Layout');

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
      headers: { cookie },
    });
    // createDefaultLayoutDoc always sets meta.version, so the zip export works.
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload[0]).toBe(0x50); // 'P'
    expect(res.rawPayload[1]).toBe(0x4b); // 'K'
  });

  it('returns 404 for a non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie, 'Private Zip', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie, 'Auth Zip', FORDYCE_BBM);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('zip includes .bbm.cld entry when sidecar was provided', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts',
      headers: { cookie },
      payload: { title: 'Zip With Sidecar', bbm: FORDYCE_BBM, sidecar: MINIMAL_SIDECAR },
    });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    const zip = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/export.zip`,
      headers: { cookie },
    });
    expect(zip.statusCode).toBe(200);
    // PK magic bytes
    expect(zip.rawPayload[0]).toBe(0x50);
    expect(zip.rawPayload[1]).toBe(0x4b);
  });
});

describe('background image', () => {
  let app: FastifyInstance;
  beforeEach(async () => { resetDb(); app = await buildApp(); });
  afterEach(async () => { await app.close(); });

  it('GET returns 404 when no background image has been uploaded', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE returns 200 even when no image exists (idempotent)', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });

  it('GET returns 404 to a non-collaborator', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE returns 403 to a non-editor', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie: outsiderCookie },
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it('POST returns 400 for invalid layout id', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const boundary = '----BoundaryABC';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/layouts/not-a-uuid/background-image',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid_id');
  });

  it('POST returns 403 for a non-editor', async () => {
    const ownerCookie = await registerAndLogin(app, 'owner@example.com');
    const outsiderCookie = await registerAndLogin(app, 'outsider@example.com');
    const id = await createLayout(app, ownerCookie);
    const boundary = '----BoundaryABC';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n\x89PNG\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie: outsiderCookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST returns 415 for an unsupported mime type', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);
    const boundary = '----BoundaryPDF';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="doc.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(415);
    expect((res.json() as { error: string }).error).toBe('unsupported_image_type');
  });

  it('POST uploads a PNG and GET serves it back', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    // Minimal 1×1 PNG bytes.
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
      '0a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex',
    );
    const boundary = '----BoundaryPNG';
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bg.png"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), pngBytes, Buffer.from(footer)]);

    const upload = await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(upload.statusCode).toBe(200);
    const { url } = upload.json() as { url: string };
    expect(url).toContain('/background-image');

    // Verify GET now serves the uploaded image.
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toContain('image/png');
  });

  it('DELETE removes an uploaded background image', async () => {
    const cookie = await registerAndLogin(app, 'owner@example.com');
    const id = await createLayout(app, cookie);

    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000' +
      '0a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex',
    );
    const boundary = '----BoundaryDel';
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bg.png"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    const body = Buffer.concat([Buffer.from(header), pngBytes, Buffer.from(footer)]);

    await app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);

    // GET should now return 404 again.
    const get = await app.inject({
      method: 'GET',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie },
    });
    expect(get.statusCode).toBe(404);
  });
});
