// Save as module: "Save to" starts at whoever owns the layout being edited,
// and a module whose contents fail to upload is removed again, so a
// blocked save never leaves an empty module behind.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { addLayer, renameLayer, setLayerTransparency } from '../mutations';
import { ensureBrickLayer, placeBrick } from '../mutations';
import { SaveModuleDialog } from '../SaveModuleDialog';

let calls: { method: string; path: string; body: unknown }[];
let snapshots: Uint8Array[];
let snapshotStatus: number;

beforeEach(() => {
  calls = [];
  snapshots = [];
  snapshotStatus = 200;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: input, body });
    if (init?.body instanceof Uint8Array) snapshots.push(init.body);
    const json = (status: number, out: unknown) =>
      new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && input === '/api/orgs')
      return json(200, { orgs: [{ id: 'org1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'admin' }] });
    if (method === 'POST' && input === '/api/modules') return json(201, { id: 'm1', title: 'Yard' });
    if (method === 'PUT' && input === '/api/modules/m1/snapshot')
      return snapshotStatus === 200 ? json(200, { updatedAt: 1 }) : json(snapshotStatus, { error: 'forbidden' });
    if (method === 'DELETE' && input === '/api/modules/m1') return json(200, { ok: true });
    return json(404, { error: 'not_found' });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(layoutOwnerOrgId: string | null) {
  const doc = new Y.Doc();
  const layer = ensureBrickLayer(doc);
  placeBrick(doc, layer, { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
  const map = docToBbm(doc);
  const id = (map.layers.find((l) => l.type === 'brick') as { bricks: { id: string }[] }).bricks[0]!.id;
  const onSaved = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SaveModuleDialog map={map} selection={[id]} layoutOwnerOrgId={layoutOwnerOrgId} onClose={() => {}} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return { onSaved };
}

async function save() {
  fireEvent.change(screen.getByPlaceholderText('My module'), { target: { value: 'Yard' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
}

describe('SaveModuleDialog', () => {
  it("starts Save to at the layout's club, and at Me for a personal layout", async () => {
    setup('org1');
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(select.value).toBe('arklug');
    cleanup();
    setup(null);
    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('');
  });

  it('saves to the picked owner', async () => {
    const { onSaved } = setup('org1');
    await screen.findByRole('combobox');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('m1', 'Yard'));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ title: 'Yard', orgSlug: 'arklug' });
  });

  it("removes the new module again when its contents can't be saved", async () => {
    snapshotStatus = 403;
    const { onSaved } = setup(null);
    await screen.findByRole('combobox');
    await save();
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/modules/m1')).toBe(true));
    expect(onSaved).not.toHaveBeenCalled();
    expect(await screen.findByText(/permission/i)).toBeTruthy();
  });

  it('says which sheets the module uses, and can put everything on one sheet', async () => {
    const doc = new Y.Doc();
    const track = addLayer(doc, 'brick');
    renameLayer(doc, track, 'Track');
    setLayerTransparency(doc, track, 70);
    const town = addLayer(doc, 'brick');
    renameLayer(doc, town, 'Buildings');
    const ids = [
      placeBrick(doc, track, { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 }),
      placeBrick(doc, town, { partNumber: '3001', x: 8, y: 0, width: 4, height: 2 }),
      placeBrick(doc, town, { partNumber: '3001', x: 12, y: 0, width: 4, height: 2 }),
    ];
    const onSaved = vi.fn();
    const show = () =>
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <SaveModuleDialog map={docToBbm(doc)} selection={ids} onClose={() => {}} onSaved={onSaved} />
        </QueryClientProvider>,
      );
    const saved = () => {
      const d = new Y.Doc();
      Y.applyUpdate(d, snapshots.at(-1)!);
      return docToBbm(d).layers.map((l) => [l.name, l.transparency, l.type === 'brick' ? l.bricks.length : 0]);
    };
    show();
    expect(screen.getByTestId('module-sheets').textContent).toContain('This module uses 2 sheets: Track, Buildings.');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saved()).toEqual([['Track', 70, 1], ['Buildings', 100, 2]]);
    cleanup();
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Put everything on one sheet' }));
    expect(screen.getByTestId('module-sheets').textContent).toContain('All its parts go on one sheet: Buildings.');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    expect(saved()).toEqual([['Buildings', 100, 3]]);
  });

  it("doesn't mention sheets for a one-sheet module", async () => {
    setup(null);
    await screen.findByRole('combobox');
    expect(screen.queryByTestId('module-sheets')).toBeNull();
  });
});
