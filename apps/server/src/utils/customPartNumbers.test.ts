// Files for BlueBrick and the desktop name a server's custom part by its
// part number, not the website's "custom:<id>" key.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readBbm, writeBbm } from '@cld/bbm';
import type { BbmMap } from '@cld/model';
import { db, resetDb, schema } from '../test/helpers.js';
import { withCustomPartNumbers } from './customPartNumbers.js';
import { encodeDoc, seedFromBbm } from '@cld/ydoc';
import { layoutFileBytes } from '../privacy/exportFiles.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../../packages/bbm/tests/fixtures/fordyce-2026.bbm');

async function addPart(partNumber: string): Promise<string> {
  const now = new Date();
  const owner = randomUUID();
  await db.insert(schema.users).values({ id: owner, email: `${owner}@example.com`, displayName: 'o', createdAt: now });
  const id = randomUUID();
  await db.insert(schema.customParts).values({
    id,
    partNumber,
    displayName: partNumber,
    ownerUserId: owner,
    createdBy: owner,
    xmlBlob: Buffer.from('<part/>'),
    spriteBlob: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    spriteMime: 'image/png',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const brickLayers = (m: BbmMap) => m.layers.filter((l) => l.type === 'brick');

describe('withCustomPartNumbers', () => {
  beforeEach(() => resetDb());

  it('names custom:<id> bricks by their part number, in any case, and leaves the rest alone', async () => {
    const id = await addPart('Ninjago_City_70620');
    const map = readBbm(readFileSync(FIXTURE, 'utf-8')).map;
    const layer = brickLayers(map)[0]!;
    if (layer.type !== 'brick') throw new Error('no brick sheet');
    const others = layer.bricks.slice(2).map((b) => b.partNumber);
    layer.bricks[0]!.partNumber = `custom:${id}`;
    layer.bricks[1]!.partNumber = `CUSTOM:${id.toUpperCase()}`;

    const out = await withCustomPartNumbers(map);
    const outLayer = brickLayers(out)[0]!;
    if (outLayer.type !== 'brick') throw new Error('no brick sheet');
    expect(outLayer.bricks[0]!.partNumber).toBe('Ninjago_City_70620');
    expect(outLayer.bricks[1]!.partNumber).toBe('Ninjago_City_70620');
    expect(outLayer.bricks.slice(2).map((b) => b.partNumber)).toEqual(others);
    expect(writeBbm(out)).not.toMatch(/custom:/i);
    // The input map is untouched.
    expect(layer.bricks[0]!.partNumber).toBe(`custom:${id}`);
  });

  it('keeps a key whose part is gone, and returns the same map when there are none', async () => {
    const map = readBbm(readFileSync(FIXTURE, 'utf-8')).map;
    expect(await withCustomPartNumbers(map)).toBe(map);
    const layer = brickLayers(map)[0]!;
    if (layer.type !== 'brick') throw new Error('no brick sheet');
    layer.bricks[0]!.partNumber = 'custom:missing';
    const out = brickLayers(await withCustomPartNumbers(map))[0]!;
    if (out.type !== 'brick') throw new Error('no brick sheet');
    expect(out.bricks[0]!.partNumber).toBe('custom:missing');
  });
});

describe('.bld-layout downloads', () => {
  beforeEach(() => resetDb());

  it('name custom parts by their part number too', async () => {
    const id = await addPart('Rivendell_10316');
    const map = readBbm(readFileSync(FIXTURE, 'utf-8')).map;
    const layer = brickLayers(map)[0]!;
    if (layer.type !== 'brick') throw new Error('no brick sheet');
    layer.bricks[0]!.partNumber = `custom:${id}`;
    let bbm = '';
    const out = await layoutFileBytes(encodeDoc(seedFromBbm(map)), null, null, null, (entries) => {
      bbm = Buffer.from(entries.find((e) => e.name === 'layout.bbm')!.data).toString('utf8');
      return new Uint8Array([1]);
    });
    expect(out).not.toBeNull();
    expect(bbm).toContain('Rivendell_10316');
    expect(bbm).not.toMatch(/custom:/i);
  });
});
