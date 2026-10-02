// Save as module: "Save to" starts at whoever owns the layout being edited,
// and a module whose contents fail to upload is removed again, so a
// blocked save never leaves an empty module behind.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { ensureBrickLayer, placeBrick } from '../mutations';
import { SaveModuleDialog } from '../SaveModuleDialog';

let calls: { method: string; path: string; body: unknown }[];
let snapshotStatus: number;

beforeEach(() => {
  calls = [];
  snapshotStatus = 200;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: input, body });
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
});
