// The module-drag ghost (MapView.cpp:1796-1900) and the panel changes
// behind it: the Module Library publishing the dragged module, and the
// Venue Library's Rename action.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h, Fragment, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDefaultLayoutDoc } from '@cld/ydoc';
import type { PartWire } from '../../api';

const konva: { type: string; props: Record<string, unknown> }[] = [];
vi.mock('react-konva', () => {
  const mk = (type: string) => (p: Record<string, unknown> & { children?: ReactNode }) => {
    konva.push({ type, props: p });
    return h(Fragment, null, p.children);
  };
  return { Group: mk('Group'), Image: mk('Image'), Rect: mk('Rect'), Circle: mk('Circle'), Line: mk('Line'), Text: mk('Text') };
});

const sprite = { naturalWidth: 32, naturalHeight: 16 } as HTMLImageElement;
vi.mock('../render/spriteCache', () => ({
  ensureSprite: () => Promise.resolve(sprite),
  getSpriteSync: (url: string) => (url ? sprite : null),
}));

const apiMock = vi.hoisted(() => ({
  modulesList: vi.fn(),
  venuesList: vi.fn(),
  venuesRename: vi.fn(),
}));
vi.mock('../../api', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../api')>();
  return {
    ...orig,
    api: {
      ...orig.api,
      modules: { ...orig.api.modules, list: apiMock.modulesList },
      venues: { ...orig.api.venues, list: apiMock.venuesList, rename: apiMock.venuesRename },
    },
  };
});

import { ModuleGhost } from '../render/ModuleGhost';
import { ModuleLibraryPanel } from '../ModuleLibraryPanel';
import { VenueLibraryPanel } from '../VenueLibraryPanel';
import { MODULE_MIME, activeModuleDrag } from '../mime';

afterEach(() => {
  cleanup();
  konva.length = 0;
  vi.restoreAllMocks();
});

function withQuery(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return h(QueryClientProvider, { client: qc }, node);
}

describe('ModuleGhost', () => {
  const part = {
    key: '3001.1',
    partNumber: '3001',
    source: 'library',
    spritePath: 'x/3001.1.gif',
    pxPerStud: 8,
    connections: [],
  } as unknown as PartWire;
  const parts = new Map([['3001.1', part]]);

  it('draws every brick shifted by the drop translation, sprites rotated about their centre', () => {
    render(
      h(ModuleGhost, {
        batches: [
          {
            layerName: 'A',
            bricks: [
              { partNumber: '3001.1', displayArea: { x: 10, y: 20, width: 4, height: 2 }, orientation: 90 },
              { partNumber: 'unknown.0', displayArea: { x: 0, y: 0, width: 2, height: 2 } },
            ],
          },
        ],
        offset: { dx: 5, dy: -3 },
        partsByKey: parts,
      }),
    );
    const group = konva.find((k) => k.type === 'Group')!;
    expect(group.props).toMatchObject({ x: 40, y: -24, opacity: 0.55, listening: false });
    const img = konva.filter((k) => k.type === 'Image').at(-1)!;
    // Natural sprite size at 8 px/stud, centred on the displayArea centre.
    expect(img.props).toMatchObject({ x: 96, y: 168, width: 32, height: 16, offsetX: 16, offsetY: 8, rotation: 90 });
    // A part without a sprite shows its displayArea box.
    const rect = konva.filter((k) => k.type === 'Rect').at(-1)!;
    expect(rect.props).toMatchObject({ x: 0, y: 0, width: 16, height: 16 });
  });
});

describe('ModuleLibraryPanel drag', () => {
  it('publishes the dragged module id for the canvas ghost, with a new session per drag', async () => {
    apiMock.modulesList.mockResolvedValue({
      modules: [{ id: '11111111-2222-3333-4444-555555555555', title: 'Loop', ownerUserId: 'u', ownerOrgId: null, docVersion: 1, hasSidecar: false, createdAt: 0, updatedAt: 0 }],
    });
    render(withQuery(h(ModuleLibraryPanel, { doc: createDefaultLayoutDoc(), isViewer: false })));
    const row = (await screen.findByText('Loop')).closest('li')!;
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: '' };
    const session = activeModuleDrag.session;
    fireEvent.dragStart(row, { dataTransfer });
    expect(data[MODULE_MIME]).toBe('11111111-2222-3333-4444-555555555555');
    expect(activeModuleDrag).toEqual({ id: '11111111-2222-3333-4444-555555555555', session: session + 1 });
    fireEvent.dragEnd(row);
    expect(activeModuleDrag.id).toBeNull();
    fireEvent.dragStart(row, { dataTransfer });
    expect(activeModuleDrag.session).toBe(session + 2);
  });
});

describe('VenueLibraryPanel rename', () => {
  it('renames through the API after a prompt, and ignores cancel / unchanged names', async () => {
    apiMock.venuesList.mockResolvedValue({ venues: [{ id: 'v1', name: 'Hall', ownerOrgId: null }] });
    apiMock.venuesRename.mockResolvedValue({ ok: true, id: 'v1', name: 'Main Hall' });
    render(withQuery(h(VenueLibraryPanel, { doc: createDefaultLayoutDoc(), isViewer: false })));
    const btn = await screen.findByRole('button', { name: 'Rename Hall' });

    const prompt = vi.spyOn(window, 'prompt');
    prompt.mockReturnValueOnce(null);
    fireEvent.click(btn);
    prompt.mockReturnValueOnce('Hall');
    fireEvent.click(btn);
    expect(apiMock.venuesRename).not.toHaveBeenCalled();

    prompt.mockReturnValueOnce('  Main Hall  ');
    fireEvent.click(btn);
    await waitFor(() => expect(apiMock.venuesRename).toHaveBeenCalledWith('v1', 'Main Hall'));
    expect(prompt).toHaveBeenLastCalledWith('New name:', 'Hall');
    // The list is refetched after a rename.
    await waitFor(() => expect(apiMock.venuesList.mock.calls.length).toBeGreaterThan(1));
  });

  it('has no Rename button for viewers', async () => {
    apiMock.venuesList.mockResolvedValue({ venues: [{ id: 'v1', name: 'Hall', ownerOrgId: null }] });
    render(withQuery(h(VenueLibraryPanel, { doc: createDefaultLayoutDoc(), isViewer: true })));
    expect(screen.queryByRole('button', { name: 'Rename Hall' })).toBeNull();
  });
});
