// @vitest-environment jsdom
// A click on the map doesn't re-render the Parts list. react-konva runs a
// canvas click's state changes synchronously inside the mouse event, and
// the list (thousands of pictures) re-rendering made the click slow enough
// that a quick double-click's second press came too late to count: no flex
// move, no Properties (desktopParity's flaky flex double-click test).

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { PartsPanel } from '../PartsPanel';
import { useEditorStore } from '../editorStore';

// Counts the Parts list's renders: it reads its picture size once per render.
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../listIconSize', async (importOriginal) => {
  const real = await importOriginal<typeof import('../listIconSize')>();
  return {
    ...real,
    useListIconSize: () => {
      renders.count += 1;
      return real.useListIconSize();
    },
  };
});

beforeEach(() => {
  vi.stubGlobal('fetch', async () =>
    new Response(
      JSON.stringify({
        parts: [{ key: '3024', partNumber: '3024', colorCode: '', kind: 'leaf', description: 'Plate 1 x 1', sortingKey: '3024', spritePath: '3024.gif', pxPerStud: 8, category: 'Plates', connections: [], subparts: [], hullPts: [], source: 'bundled', customPartId: null }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useEditorStore.setState({ selection: [] });
});

/** Like the editor: re-renders on every selection change, passes the list stable props. */
function Editor() {
  const selection = useEditorStore((s) => s.selection);
  const onPlacePart = useCallback(() => undefined, []);
  const budgetLimits = useMemo(() => new Map<string, number>(), []);
  return (
    <>
      <p>selected: {selection.length}</p>
      <PartsPanel onPlacePart={onPlacePart} budgetLimits={budgetLimits} map={null} />
    </>
  );
}

it('picking parts on the map does not re-render the Parts list', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Editor />
    </QueryClientProvider>,
  );
  await screen.findByTitle(/\(3024\)/);
  const settled = renders.count;
  act(() => useEditorStore.getState().setSelection(['a']));
  act(() => useEditorStore.getState().setSelection(['a', 'b']));
  expect(screen.getByText('selected: 2')).toBeTruthy();
  expect(renders.count).toBe(settled);
});
