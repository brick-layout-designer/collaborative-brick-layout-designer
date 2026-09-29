// The bundled catalog carries each part's old part numbers
// (<OldNameList>) so the editor can resolve maps and budgets that use
// them, and each sprite's pixel size for the brick footprint.

import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../../test/helpers.js';
import { attachUser } from '../../auth/cookie.js';
import { env } from '../../env.js';
import { partsRoutes, invalidatePartsCache } from '../parts.js';

describe('parts catalog — old part names', () => {
  let app: FastifyInstance;
  let dir: string;
  let savedPartsDir: string;

  beforeEach(async () => {
    resetDb();
    dir = mkdtempSync(join(tmpdir(), 'cld-parts-'));
    mkdirSync(join(dir, 'parts', 'Baseplate'), { recursive: true });
    writeFileSync(
      join(dir, 'parts', 'Baseplate', '4186p01.2.xml'),
      '<part><OldNameList><OldName>4186P01</OldName></OldNameList></part>',
    );
    writeFileSync(join(dir, 'parts', 'Baseplate', '3811.2.xml'), '<part></part>');
    writeFileSync(
      join(dir, 'parts', 'Baseplate', 'TRACK.8.xml'),
      `<part>
        <LDraw><Angle>90</Angle></LDraw>
        <TrackDesigner><ID>42</ID><TDBitmapList><TDBitmap><Type>2</Type></TDBitmap></TDBitmapList></TrackDesigner>
        <FourDBrix><PartType>TABLE</PartType><PartName>t.svg</PartName></FourDBrix>
      </part>`,
    );
    // A 256 x 128 GIF header for 3811.2's sprite.
    writeFileSync(join(dir, 'parts', 'Baseplate', '3811.2.gif'), Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x01, 0x80, 0x00]));
    savedPartsDir = env.partsDir;
    env.partsDir = dir;
    invalidatePartsCache();
    app = Fastify();
    await app.register(cookie);
    app.addHook('preHandler', attachUser);
    await app.register(partsRoutes);
  });

  afterEach(async () => {
    await app.close();
    env.partsDir = savedPartsDir;
    invalidatePartsCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends oldNames for parts that have them and omits the field otherwise', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    expect(res.statusCode).toBe(200);
    const parts = (res.json() as { parts: { key: string; oldNames?: string[] }[] }).parts;
    expect(parts.find((p) => p.key === '4186p01.2')?.oldNames).toEqual(['4186P01']);
    expect(parts.find((p) => p.key === '3811.2')).not.toHaveProperty('oldNames');
  });

  it('sends each sprite\'s pixel size for the footprint, and omits it without a sprite', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    const parts = (res.json() as { parts: { key: string; spriteSize?: unknown }[] }).parts;
    expect(parts.find((p) => p.key === '3811.2')?.spriteSize).toEqual({ w: 256, h: 128 });
    expect(parts.find((p) => p.key === '4186p01.2')).not.toHaveProperty('spriteSize');
  });

  it('sends the LDraw, TrackDesigner and 4DBrix remaps, and omits them when absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/parts/catalog' });
    const parts = (res.json() as { parts: Record<string, unknown>[] }).parts;
    expect(parts.find((p) => p.key === 'track.8')).toMatchObject({
      ldraw: { angle: 90, translation: { x: 0, y: 0 }, preferredHeight: 0, sleeper: '', alias: '' },
      trackDesigner: { defaultId: 42, registryIds: {}, flags: 0, hasSeveralPorts: false, ports: [{ bbConnectionIndex: 0, type: 2, angleDifference: 0 }] },
      fourDBrix: { type: 'table', partName: 't.svg', orientationDifference: 0, originConnection: 0 },
    });
    const plain = parts.find((p) => p.key === '3811.2')!;
    for (const k of ['ldraw', 'trackDesigner', 'fourDBrix']) expect(plain).not.toHaveProperty(k);
  });
});
