// GET /api/version — what a desktop live-sync client checks first.

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DOC_SCHEMA_VERSION } from '@cld/ydoc';
import { versionRoutes } from '../version.js';

describe('GET /api/version', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = Fastify();
    await app.register(versionRoutes);
  });
  afterEach(async () => {
    await app.close();
  });

  it('is public and reports version, schemaVersion and protocols', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '0.0.0', schemaVersion: DOC_SCHEMA_VERSION, protocols: ['y-websocket/1'] });
    expect(DOC_SCHEMA_VERSION).toBe(1);
  });

  it('prefers APP_VERSION when set', async () => {
    process.env.APP_VERSION = '1.2.3';
    try {
      const other = Fastify();
      await other.register(versionRoutes);
      expect((await other.inject({ method: 'GET', url: '/api/version' })).json().version).toBe('1.2.3');
      await other.close();
    } finally {
      delete process.env.APP_VERSION;
    }
  });
});
