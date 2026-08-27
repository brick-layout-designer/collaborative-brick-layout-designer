// Unit tests for sidecar-module, venue, and background-image mutations.
// Mirrors the pattern in mutations2.test.ts — every describe block has
// positive (happy-path) and negative (edge-case / no-op) tests.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SidecarModule } from '@cld/bbm';
import {
  ensureBrickLayer,
  addSidecarModule,
  renameSidecarModule,
  deleteSidecarModule,
  setSidecarModuleMembers,
  flattenSidecarModule,
  moveModuleBricks,
  rotateModuleBricks,
  patchSidecarModule,
  setVenue,
  setBackgroundImage,
  clearBackgroundImage,
} from '../mutations';

function blankDoc(): Y.Doc {
  return new Y.Doc();
}

function readCache(doc: Y.Doc): Record<string, unknown> {
  const cache = doc.getMap('meta').get('cache');
  return (cache && typeof cache === 'object' ? cache : {}) as Record<string, unknown>;
}

function makeModule(overrides?: Partial<SidecarModule>): SidecarModule {
  return {
    id: 'mod-1',
    name: 'Module A',
    members: ['b1', 'b2'],
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...overrides,
  };
}

// ---- addSidecarModule -------------------------------------------------------

describe('addSidecarModule', () => {
  it('appends the module to the sidecar cache', () => {
    const doc = blankDoc();
    const mod = makeModule();
    addSidecarModule(doc, mod);
    const cache = readCache(doc);
    const modules = cache.modules as SidecarModule[];
    expect(Array.isArray(modules)).toBe(true);
    expect(modules).toHaveLength(1);
    expect(modules[0]!.id).toBe('mod-1');
  });

  it('accumulates multiple modules in order', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'a', name: 'A' }));
    addSidecarModule(doc, makeModule({ id: 'b', name: 'B' }));
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules).toHaveLength(2);
    expect(modules[0]!.id).toBe('a');
    expect(modules[1]!.id).toBe('b');
  });

  it('does not mutate unrelated cache keys', () => {
    const doc = blankDoc();
    doc.getMap('meta').set('cache', { anchoredLabels: [{ id: 'lbl', brickId: 'b', offset: { x: 0, y: 0 }, text: 't' }] });
    addSidecarModule(doc, makeModule());
    const cache = readCache(doc);
    expect(Array.isArray(cache.anchoredLabels)).toBe(true);
    expect((cache.anchoredLabels as unknown[]).length).toBe(1);
  });
});

// ---- renameSidecarModule ----------------------------------------------------

describe('renameSidecarModule', () => {
  it('updates the name of the target module', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'Old' }));
    renameSidecarModule(doc, 'm1', 'New Name');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.name).toBe('New Name');
  });

  it('leaves other modules unchanged', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'A' }));
    addSidecarModule(doc, makeModule({ id: 'm2', name: 'B' }));
    renameSidecarModule(doc, 'm1', 'A-renamed');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[1]!.name).toBe('B');
  });

  it('is a no-op for an unknown id', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'X' }));
    renameSidecarModule(doc, 'nonexistent', 'Y');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.name).toBe('X');
  });

  it('allows renaming to empty string', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'Named' }));
    renameSidecarModule(doc, 'm1', '');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.name).toBe('');
  });
});

// ---- deleteSidecarModule ----------------------------------------------------

describe('deleteSidecarModule', () => {
  it('removes the module from the cache', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1' }));
    deleteSidecarModule(doc, 'm1');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules).toHaveLength(0);
  });

  it('removes only the targeted module', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1' }));
    addSidecarModule(doc, makeModule({ id: 'm2' }));
    deleteSidecarModule(doc, 'm1');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules).toHaveLength(1);
    expect(modules[0]!.id).toBe('m2');
  });

  it('is a no-op for an unknown id', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1' }));
    deleteSidecarModule(doc, 'ghost');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules).toHaveLength(1);
  });

  it('is a no-op when called on an empty cache', () => {
    const doc = blankDoc();
    expect(() => deleteSidecarModule(doc, 'x')).not.toThrow();
  });
});

// ---- setSidecarModuleMembers ------------------------------------------------

describe('setSidecarModuleMembers', () => {
  it('replaces the member list for the target module', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', members: ['b1', 'b2'] }));
    setSidecarModuleMembers(doc, 'm1', ['b3', 'b4', 'b5']);
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.members).toEqual(['b3', 'b4', 'b5']);
  });

  it('allows setting an empty members array', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', members: ['b1'] }));
    setSidecarModuleMembers(doc, 'm1', []);
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.members).toHaveLength(0);
  });

  it('leaves other modules unaffected', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', members: ['a'] }));
    addSidecarModule(doc, makeModule({ id: 'm2', members: ['b'] }));
    setSidecarModuleMembers(doc, 'm1', ['c', 'd']);
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[1]!.members).toEqual(['b']);
  });

  it('is a no-op for unknown id', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', members: ['x'] }));
    setSidecarModuleMembers(doc, 'ghost', ['y']);
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.members).toEqual(['x']);
  });
});

// ---- flattenSidecarModule ---------------------------------------------------

describe('flattenSidecarModule', () => {
  it('removes the module from the sidecar (alias for deleteSidecarModule)', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1' }));
    flattenSidecarModule(doc, 'm1');
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules).toHaveLength(0);
  });

  it('leaves bricks in place (bricks are NOT deleted)', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    bricks.push([b]);

    addSidecarModule(doc, makeModule({ id: 'm1', members: ['b1'] }));
    flattenSidecarModule(doc, 'm1');

    expect(bricks.length).toBe(1);
    expect(bricks.get(0).get('id')).toBe('b1');
  });
});

// ---- moveModuleBricks -------------------------------------------------------

describe('moveModuleBricks', () => {
  it('translates member bricks by the given delta', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 4, y: 2, width: 2, height: 2 });
    bricks.push([b]);

    moveModuleBricks(doc, ['b1'], 3, 5);
    const area = bricks.get(0).get('displayArea') as { x: number; y: number };
    expect(area.x).toBeCloseTo(7);
    expect(area.y).toBeCloseTo(7);
  });

  it('scans all layers for member bricks', () => {
    const doc = blankDoc();
    const l1 = ensureBrickLayer(doc);
    // Add a second brick layer manually.
    const l2 = 'layer-2';
    doc.getArray<string>('layers').push([l2]);
    const ld2 = new Y.Map<unknown>();
    const bricks2 = new Y.Array<Y.Map<unknown>>();
    ld2.set('bricks', bricks2);
    ld2.set('kind', 'brick');
    ld2.set('name', 'Layer 2');
    ld2.set('visible', true);
    ld2.set('transparency', 0);
    doc.getMap('layerData').set(l2, ld2);

    const b2 = new Y.Map<unknown>();
    b2.set('id', 'b2');
    b2.set('displayArea', { x: 10, y: 10, width: 2, height: 2 });
    bricks2.push([b2]);

    moveModuleBricks(doc, ['b2'], 1, 2);
    const area = b2.get('displayArea') as { x: number; y: number };
    expect(area.x).toBeCloseTo(11);
    expect(area.y).toBeCloseTo(12);
  });

  it('is a no-op when memberIds is empty', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    bricks.push([b]);

    moveModuleBricks(doc, [], 5, 5);
    const area = b.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(0);
    expect(area.y).toBe(0);
  });

  it('is a no-op when both deltas are 0', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 3, y: 4, width: 2, height: 2 });
    bricks.push([b]);

    moveModuleBricks(doc, ['b1'], 0, 0);
    const area = b.get('displayArea') as { x: number; y: number };
    expect(area.x).toBe(3);
    expect(area.y).toBe(4);
  });

  it('does not move bricks that are not in memberIds', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b1 = new Y.Map<unknown>();
    b1.set('id', 'b1');
    b1.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    const b2 = new Y.Map<unknown>();
    b2.set('id', 'b2');
    b2.set('displayArea', { x: 5, y: 5, width: 2, height: 2 });
    bricks.push([b1, b2]);

    moveModuleBricks(doc, ['b1'], 10, 10);
    const area2 = b2.get('displayArea') as { x: number; y: number };
    expect(area2.x).toBe(5);
    expect(area2.y).toBe(5);
  });
});

// ---- rotateModuleBricks -----------------------------------------------------

describe('rotateModuleBricks', () => {
  it('rotates a single brick 90° around itself', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    b.set('orientation', 0);
    bricks.push([b]);

    rotateModuleBricks(doc, ['b1'], 90);
    const orientation = b.get('orientation') as number;
    expect(orientation % 360).toBeCloseTo(90);
  });

  it('accumulates orientation across multiple rotations', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    b.set('orientation', 0);
    bricks.push([b]);

    rotateModuleBricks(doc, ['b1'], 90);
    rotateModuleBricks(doc, ['b1'], 90);
    const orientation = b.get('orientation') as number;
    expect(orientation % 360).toBeCloseTo(180);
  });

  it('is a no-op when memberIds is empty', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    b.set('orientation', 45);
    bricks.push([b]);

    rotateModuleBricks(doc, [], 90);
    expect(b.get('orientation')).toBe(45);
  });

  it('is a no-op when degrees is 0', () => {
    const doc = blankDoc();
    const layerId = ensureBrickLayer(doc);
    const bricks = (doc.getMap('layerData').get(layerId) as Y.Map<unknown>).get('bricks') as Y.Array<Y.Map<unknown>>;
    const b = new Y.Map<unknown>();
    b.set('id', 'b1');
    b.set('displayArea', { x: 0, y: 0, width: 2, height: 2 });
    b.set('orientation', 30);
    bricks.push([b]);

    rotateModuleBricks(doc, ['b1'], 0);
    expect(b.get('orientation')).toBe(30);
  });
});

// ---- patchSidecarModule -----------------------------------------------------

describe('patchSidecarModule', () => {
  it('patches arbitrary fields on the target module', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'Original', members: ['b1'] }));
    patchSidecarModule(doc, 'm1', { sourceFile: 'my-module.cld', importedAt: '2026-01-01T00:00:00Z' });
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.sourceFile).toBe('my-module.cld');
    expect(modules[0]!.importedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('preserves fields that are not in the patch', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'Original', members: ['b1', 'b2'] }));
    patchSidecarModule(doc, 'm1', { name: 'Patched Name' });
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.members).toEqual(['b1', 'b2']);
  });

  it('is a no-op for an unknown module id', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'A' }));
    patchSidecarModule(doc, 'ghost', { name: 'B' });
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[0]!.name).toBe('A');
  });

  it('does not affect other modules', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule({ id: 'm1', name: 'A' }));
    addSidecarModule(doc, makeModule({ id: 'm2', name: 'B' }));
    patchSidecarModule(doc, 'm1', { name: 'AA' });
    const modules = (readCache(doc).modules as SidecarModule[]);
    expect(modules[1]!.name).toBe('B');
  });
});

// ---- setVenue ---------------------------------------------------------------

describe('setVenue', () => {
  const sampleVenue = {
    name: 'Test Hall',
    enabled: true,
    edges: [],
    obstacles: [],
    minWalkwayStuds: 4,
  } as unknown as import('@cld/bbm').Venue;

  it('stores the venue in the sidecar cache', () => {
    const doc = blankDoc();
    setVenue(doc, sampleVenue);
    const cache = readCache(doc);
    expect(cache.venue).toBeTruthy();
    expect((cache.venue as { name: string }).name).toBe('Test Hall');
  });

  it('overwrites a previously set venue', () => {
    const doc = blankDoc();
    setVenue(doc, sampleVenue);
    const updated = { ...sampleVenue, name: 'Updated Hall' } as unknown as import('@cld/bbm').Venue;
    setVenue(doc, updated);
    const cache = readCache(doc);
    expect((cache.venue as { name: string }).name).toBe('Updated Hall');
  });

  it('clears the venue when called with null', () => {
    const doc = blankDoc();
    setVenue(doc, sampleVenue);
    setVenue(doc, null);
    const cache = readCache(doc);
    expect(cache.venue).toBeUndefined();
  });

  it('does not disturb other sidecar keys when clearing', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule());
    setVenue(doc, sampleVenue);
    setVenue(doc, null);
    const cache = readCache(doc);
    expect(Array.isArray(cache.modules)).toBe(true);
    expect((cache.modules as SidecarModule[]).length).toBe(1);
  });
});

// ---- setBackgroundImage / clearBackgroundImage ------------------------------

describe('setBackgroundImage', () => {
  const sampleBg = {
    url: 'https://example.com/bg.png',
    opacity: 0.5,
  };

  it('stores the background image in the sidecar cache', () => {
    const doc = blankDoc();
    setBackgroundImage(doc, sampleBg);
    const cache = readCache(doc);
    expect(cache.backgroundImage).toBeTruthy();
    expect((cache.backgroundImage as { url: string }).url).toBe('https://example.com/bg.png');
  });

  it('overwrites a previously set background image', () => {
    const doc = blankDoc();
    setBackgroundImage(doc, sampleBg);
    setBackgroundImage(doc, { ...sampleBg, url: 'https://example.com/new.png' });
    const cache = readCache(doc);
    expect((cache.backgroundImage as { url: string }).url).toBe('https://example.com/new.png');
  });

  it('does not disturb other sidecar keys', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule());
    setBackgroundImage(doc, sampleBg);
    const cache = readCache(doc);
    expect(Array.isArray(cache.modules)).toBe(true);
  });
});

describe('clearBackgroundImage', () => {
  it('removes the background image from the cache', () => {
    const doc = blankDoc();
    setBackgroundImage(doc, { url: 'u', opacity: 1 });
    clearBackgroundImage(doc);
    const cache = readCache(doc);
    expect(cache.backgroundImage).toBeUndefined();
  });

  it('is a no-op when there is no background image', () => {
    const doc = blankDoc();
    expect(() => clearBackgroundImage(doc)).not.toThrow();
    const cache = readCache(doc);
    expect(cache.backgroundImage).toBeUndefined();
  });

  it('does not disturb other sidecar keys when clearing', () => {
    const doc = blankDoc();
    addSidecarModule(doc, makeModule());
    setBackgroundImage(doc, { url: 'u', opacity: 1 });
    clearBackgroundImage(doc);
    const cache = readCache(doc);
    expect(Array.isArray(cache.modules)).toBe(true);
    expect((cache.modules as SidecarModule[]).length).toBe(1);
  });
});
