// Regression tests for background-image uploads:
//   - a new image of a different type replaces (not hides behind) the old
//   - an oversized upload is rejected without destroying the current image

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bufConcat, loginAs, resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { passwordRoutes } from '../auth/password.js';
import { layoutRoutes } from '../layouts.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 20 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(fastifyMultipart);
  app.addHook('preHandler', attachUser);
  await app.register(passwordRoutes);
  await app.register(layoutRoutes);
  return app;
}

function multipart(bytes: Buffer, mime: string, filename: string): { body: Buffer; contentType: string } {
  const boundary = '----BgBoundary' + Math.random().toString(36).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`;
  return {
    body: bufConcat([Buffer.from(header), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('background image upload', () => {
  let app: FastifyInstance;
  let c: string;
  let id: string;

  beforeEach(async () => {
    resetDb();
    app = await buildApp();
    c = (await loginAs(app, 'bg@x.com')).cookie;
    id = (await app.inject({ method: 'POST', url: '/api/layouts', headers: { cookie: c }, payload: {} })).json().id;
  });
  afterEach(async () => {
    await app.inject({ method: 'DELETE', url: `/api/layouts/${id}/background-image`, headers: { cookie: c } });
    await app.close();
  });

  async function upload(bytes: Buffer, mime: string, filename: string) {
    const { body, contentType } = multipart(bytes, mime, filename);
    return app.inject({
      method: 'POST',
      url: `/api/layouts/${id}/background-image`,
      headers: { cookie: c, 'content-type': contentType },
      payload: body,
    });
  }

  async function get() {
    return app.inject({ method: 'GET', url: `/api/layouts/${id}/background-image`, headers: { cookie: c } });
  }

  it('a new JPEG replaces an earlier PNG instead of being shadowed by it', async () => {
    expect((await upload(Buffer.from('png-bytes'), 'image/png', 'a.png')).statusCode).toBe(200);
    expect((await upload(Buffer.from('jpeg-bytes'), 'image/jpeg', 'b.jpg')).statusCode).toBe(200);
    const res = await get();
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.body).toBe('jpeg-bytes');
  });

  it('an oversized upload is rejected and leaves the current image intact', async () => {
    expect((await upload(Buffer.from('original'), 'image/png', 'a.png')).statusCode).toBe(200);
    const big = await upload(Buffer.alloc(10 * 1024 * 1024 + 10, 1), 'image/png', 'big.png');
    expect(big.statusCode).toBe(413);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('original');
  });
});
