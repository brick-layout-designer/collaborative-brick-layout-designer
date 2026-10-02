// @vitest-environment jsdom
// The touch Sheets list: show / hide, rename and reorder with big
// buttons, through the same mutations as the Sheets panel.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { docToBbm } from '@cld/ydoc';
import { ensureBrickLayer, ensureRulerLayer, ensureTextLayer, renameLayer } from '../mutations';
import { SheetsSheet, TextEditSheet } from '../TouchSheets';
import { useEditorStore } from '../editorStore';

function setup() {
  const doc = new Y.Doc();
  const parts = ensureBrickLayer(doc);
  renameLayer(doc, parts, 'Tracks');
  const text = ensureTextLayer(doc);
  renameLayer(doc, text, 'Labels');
  const rulers = ensureRulerLayer(doc);
  renameLayer(doc, rulers, 'Sizes');
  const view = () => render(<SheetsSheet map={docToBbm(doc)} doc={doc} onClose={() => {}} />);
  const names = () => docToBbm(doc).layers.map((l) => l.name);
  return { doc, parts, view, names };
}

afterEach(() => {
  cleanup();
  useEditorStore.setState({ activeLayerId: null });
});

describe('the touch Sheets list', () => {
  it('lists the top sheet first, with finger-sized buttons for each', () => {
    const { view } = setup();
    view();
    const rows = within(screen.getByRole('list', { name: 'Sheets, top first' })).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.font-bold')!.textContent)).toEqual(['Sizes', 'Labels', 'Tracks']);
    expect(screen.getByRole('button', { name: 'Move Sizes up' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Move Tracks down' })).toHaveProperty('disabled', true);
    for (const b of screen.getAllByRole('button', { name: /^(Hide|Rename|Move) / })) expect(b.className).toContain('size-11');
  });

  it('hides and shows a sheet', () => {
    const { doc, parts, view } = setup();
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Tracks' }));
    expect(docToBbm(doc).layers.find((l) => l.id === parts)!.visible).toBe(false);
    cleanup();
    view();
    expect(screen.getByRole('button', { name: 'Show Tracks' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Show Tracks' }));
    expect(docToBbm(doc).layers.find((l) => l.id === parts)!.visible).toBe(true);
  });

  it('renames a sheet, and leaves it alone on an empty name', () => {
    const { names, view } = setup();
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Tracks' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for Tracks' }), { target: { value: '  Main line ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(names()).toEqual(['Main line', 'Labels', 'Sizes']);
    cleanup();
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Labels' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New name for Labels' }), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(names()).toEqual(['Main line', 'Labels', 'Sizes']);
  });

  it('moves a sheet up and down', () => {
    const { names, view } = setup();
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Move Tracks up' }));
    expect(names()).toEqual(['Labels', 'Tracks', 'Sizes']);
    cleanup();
    view();
    fireEvent.click(screen.getByRole('button', { name: 'Move Sizes down' }));
    expect(names()).toEqual(['Labels', 'Sizes', 'Tracks']);
  });

  it('picks the sheet a tap lands on', () => {
    const { parts, view } = setup();
    view();
    fireEvent.click(screen.getByText('Tracks'));
    expect(useEditorStore.getState().activeLayerId).toBe(parts);
  });
});

describe('the touch text editor', () => {
  it('saves new words, saves nothing when they are the same, and refuses empty text', () => {
    const saved: string[] = [];
    let closed = 0;
    const show = () =>
      render(<TextEditSheet title="Edit label" initial="Station" onSave={(t) => saved.push(t)} onClose={() => closed++} />);
    show();
    const box = screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Station');
    fireEvent.change(box, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    fireEvent.change(box, { target: { value: 'Main station' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual(['Main station']);
    expect(closed).toBe(1);
    cleanup();
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toEqual(['Main station']);
    expect(closed).toBe(2);
  });
});
