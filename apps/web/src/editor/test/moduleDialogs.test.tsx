// The module dialogs: Make a module makes an in-layout module only (and,
// with "Also save to my Module library", saves and links it too); Save to
// library… saves a placed module to you or a club, removes the Module library
// module again when its contents fail, and links the placed module; Update
// library version saves the next version of the linked library module.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Y from 'yjs';
import { docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import { addLayer, addSidecarModule, ensureBrickLayer, placeBrick, renameLayer, setLayerTransparency } from '../mutations';
import { MakeModuleDialog, PublishModuleDialog, SaveToLibraryDialog } from '../ModuleDialogs';

const confirmed: string[] = [];
let answer = true;
vi.mock('../../ui/ConfirmDialog', () => ({
  askConfirm: async (o: { title: string }) => {
    confirmed.push(o.title);
    return answer;
  },
}));

let calls: { method: string; path: string; body: unknown }[];
let snapshots: Uint8Array[];
let snapshotStatus: number;

beforeEach(() => {
  calls = [];
  snapshots = [];
  snapshotStatus = 200;
  confirmed.length = 0;
  answer = true;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: input, body });
    if (init?.body instanceof Uint8Array) snapshots.push(init.body);
    const json = (status: number, out: unknown) =>
      new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'GET' && input === '/api/orgs')
      return json(200, { orgs: [{ id: 'org1', name: 'ArkLUG', slug: 'arklug', createdAt: 0, myRole: 'admin' }] });
    if (method === 'GET' && input === '/api/modules')
      return json(200, { modules: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Yard', role: 'owner', latestVersion: 3, ownerUserId: 'u', ownerOrgId: null, docVersion: 3, hasSidecar: false, createdAt: 0, updatedAt: 0 }] });
    if (method === 'POST' && input === '/api/modules') return json(201, { id: 'm1', title: 'Yard' });
    if (method === 'PUT' && /^\/api\/modules\/(m1|11111111-1111-4111-8111-111111111111)\/snapshot/.test(input))
      return snapshotStatus === 200 ? json(200, { updatedAt: 1, version: input.includes('11111111-') ? 4 : 1 }) : json(snapshotStatus, { error: 'forbidden' });
    if (method === 'DELETE' && input === '/api/modules/m1') return json(200, { ok: true });
    return json(404, { error: 'not_found' });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A layout with one part, made a module ("Yard"). */
function layout(linked = false) {
  const doc = new Y.Doc();
  const layer = ensureBrickLayer(doc);
  const id = placeBrick(doc, layer, { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
  addSidecarModule(doc, {
    id: 'pm',
    name: 'Yard',
    members: [id],
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    ...(linked ? { libraryModuleId: '11111111-1111-4111-8111-111111111111', libraryVersion: 3 } : {}),
  });
  return { doc, id };
}
const placed = (doc: Y.Doc) => readSidecarFromDoc(doc)!.modules!;

function showSave(doc: Y.Doc, layoutOwnerOrgId: string | null) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client()}>
      <SaveToLibraryDialog doc={doc} moduleId="pm" layoutOwnerOrgId={layoutOwnerOrgId} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('Save to Module library…', () => {
  it("starts Save to at the layout's club, and at Me for a personal layout", async () => {
    showSave(layout().doc, 'org1');
    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('arklug');
    cleanup();
    showSave(layout().doc, null);
    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('');
  });

  it('asks before saving into a club, saves there, and links the placed module', async () => {
    const { doc } = layout();
    const { onClose } = showSave(doc, 'org1');
    await screen.findByRole('combobox');
    expect((screen.getByLabelText('Module name') as HTMLInputElement).value).toBe('Yard');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(confirmed).toEqual(['Save it to ArkLUG?']);
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ title: 'Yard', orgSlug: 'arklug' });
    expect(placed(doc)[0]).toMatchObject({ libraryModuleId: 'm1', libraryVersion: 1 });
  });

  it('saves nothing when the club question is cancelled', async () => {
    answer = false;
    const { doc } = layout();
    const { onClose } = showSave(doc, 'org1');
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(confirmed).toHaveLength(1));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(placed(doc)[0]!.libraryModuleId).toBeUndefined();
  });

  it("removes the new library module again when its contents can't be saved, and doesn't link", async () => {
    snapshotStatus = 403;
    const { doc } = layout();
    showSave(doc, null);
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/modules/m1')).toBe(true));
    expect(await screen.findByText(/permission/i)).toBeTruthy();
    expect(placed(doc)[0]!.libraryModuleId).toBeUndefined();
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
    addSidecarModule(doc, { id: 'pm', name: 'Town', members: ids, transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    const saved = () => {
      const d = new Y.Doc();
      Y.applyUpdate(d, snapshots.at(-1)!);
      return docToBbm(d).layers.map((l) => [l.name, l.transparency, l.type === 'brick' ? l.bricks.length : 0]);
    };
    let r = showSave(doc, null);
    expect((await screen.findByTestId('module-sheets')).textContent).toContain('This module uses 2 sheets: Track, Buildings.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(r.onClose).toHaveBeenCalled());
    expect(saved()).toEqual([['Track', 70, 1], ['Buildings', 100, 2]]);
    cleanup();
    r = showSave(doc, null);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Put everything on one sheet' }));
    expect(screen.getByTestId('module-sheets').textContent).toContain('All its parts go on one sheet: Buildings.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(r.onClose).toHaveBeenCalled());
    expect(saved()).toEqual([['Buildings', 100, 3]]);
  });

  it("doesn't mention sheets for a one-sheet module", async () => {
    showSave(layout().doc, null);
    await screen.findByRole('combobox');
    expect(screen.queryByTestId('module-sheets')).toBeNull();
  });
});

describe('Make a module', () => {
  function showMake(doc: Y.Doc, selection: string[], layoutOwnerOrgId: string | null = null) {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <MakeModuleDialog doc={doc} selection={selection} layoutOwnerOrgId={layoutOwnerOrgId} onClose={onClose} />
      </QueryClientProvider>,
    );
    return { onClose };
  }

  it('makes a module in this layout only: nothing goes to the Module library', async () => {
    const doc = new Y.Doc();
    const layer = ensureBrickLayer(doc);
    const id = placeBrick(doc, layer, { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
    const { onClose } = showMake(doc, [id]);
    fireEvent.change(screen.getByLabelText('Module name'), { target: { value: 'Desert corner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make module' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(placed(doc)).toMatchObject([{ name: 'Desert corner', members: [id] }]);
    expect(placed(doc)[0]!.libraryModuleId).toBeUndefined();
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });

  it('wants a name', async () => {
    const doc = new Y.Doc();
    const id = placeBrick(doc, ensureBrickLayer(doc), { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
    showMake(doc, [id]);
    fireEvent.click(screen.getByRole('button', { name: 'Make module' }));
    expect(await screen.findByText('Give the module a name.')).toBeTruthy();
    expect(readSidecarFromDoc(doc)?.modules ?? []).toHaveLength(0);
  });

  it('with "Also save to my Module library", makes it, saves it and links it in one go', async () => {
    const doc = new Y.Doc();
    const id = placeBrick(doc, ensureBrickLayer(doc), { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
    const { onClose } = showMake(doc, [id]);
    fireEvent.change(screen.getByLabelText('Module name'), { target: { value: 'Yard' } });
    fireEvent.click(screen.getByTestId('make-module-also-save'));
    fireEvent.click(screen.getByRole('button', { name: 'Make and save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ title: 'Yard' });
    expect(placed(doc)).toMatchObject([{ name: 'Yard', members: [id], libraryModuleId: 'm1', libraryVersion: 1 }]);
  });
});

describe('Make a module, saved into a club', () => {
  it('asks first; No makes nothing and saves nothing', async () => {
    answer = false;
    const doc = new Y.Doc();
    const id = placeBrick(doc, ensureBrickLayer(doc), { partNumber: '3001', x: 0, y: 0, width: 4, height: 2 });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <MakeModuleDialog doc={doc} selection={[id]} layoutOwnerOrgId="org1" onClose={onClose} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Module name'), { target: { value: 'Yard' } });
    fireEvent.click(screen.getByTestId('make-module-also-save'));
    expect(((await screen.findByRole('combobox')) as HTMLSelectElement).value).toBe('arklug');
    fireEvent.click(screen.getByRole('button', { name: 'Make and save' }));
    await waitFor(() => expect(confirmed).toEqual(['Save it to ArkLUG?']));
    expect(readSidecarFromDoc(doc)?.modules ?? []).toHaveLength(0);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Update Module library version', () => {
  it('saves the next version of the linked library module, with the note, and moves the link on', async () => {
    const { doc } = layout(true);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client()}>
        <PublishModuleDialog doc={doc} moduleId="pm" onClose={onClose} />
      </QueryClientProvider>,
    );
    expect((await screen.findByText(/become version 4 of/)).textContent).toContain('Yard');
    fireEvent.change(screen.getByLabelText('What changed? (optional)'), { target: { value: 'Longer siding' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PUT')!.path).toBe('/api/modules/11111111-1111-4111-8111-111111111111/snapshot?note=Longer%20siding');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    expect(placed(doc)[0]).toMatchObject({ libraryModuleId: '11111111-1111-4111-8111-111111111111', libraryVersion: 4 });
  });
});
