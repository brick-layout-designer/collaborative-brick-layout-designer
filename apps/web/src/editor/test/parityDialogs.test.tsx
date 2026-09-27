// Component tests for the desktop-parity dialog changes: anchored-label
// placement defaults and colour round-trip, Find & Replace buttons, the
// Budget dialog writing to the doc, and the Export Image options.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import type { AnchoredLabel } from '@cld/bbm';
import { createDefaultLayoutDoc, docToBbm, readSidecarFromDoc } from '@cld/ydoc';
import { AddAnchoredLabelDialog } from '../AddAnchoredLabelDialog';
import { FindDialog } from '../FindDialog';
import { BudgetDialog } from '../BudgetDialog';
import { ExportImageDialog, type ExportHandle } from '../ExportImageDialog';
import { addAnchoredLabel, placeBrick, readBudgetLimits, setBudgetLimits } from '../mutations';
import { createUndoManager } from '../useUndoManager';

afterEach(cleanup);

function brickLayerId(doc: Y.Doc): string {
  return docToBbm(doc).layers.find((l) => l.type === 'brick')!.id;
}

function labels(doc: Y.Doc): AnchoredLabel[] {
  return readSidecarFromDoc(doc)?.anchoredLabels ?? [];
}

function numberInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
}

const KNOWN_RED: AnchoredLabel = {
  id: '77',
  text: 'Depot',
  font: { family: 'Arial', size: 12, style: 'Regular' },
  color: { known: true, argb: 0xffff0000, name: 'Red' },
  kind: 0,
  targetId: '',
  offset: { x: 5, y: 6 },
  rot: 0,
  minZoom: 0,
};

describe('AddAnchoredLabelDialog', () => {
  it('places a new World label at the view centre', () => {
    const doc = createDefaultLayoutDoc();
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId={null} viewCentre={{ x: 12.345, y: -7.891 }} onClose={() => {}} />);
    // Number inputs: size, offset X, offset Y, rotation, min zoom.
    expect(numberInputs()[1]!.value).toBe('12.35');
    expect(numberInputs()[2]!.value).toBe('-7.89');
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Centre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Label' }));
    const [l] = labels(doc);
    expect(l).toMatchObject({ text: 'Centre', kind: 0, offset: { x: 12.35, y: -7.89 } });
    // Crypto makeId: a decimal ulong, not a Date.now() string.
    expect(l!.id).toMatch(/^[1-9]\d*$/);
    expect(BigInt(l!.id)).toBeLessThan(2n ** 63n);
  });

  it('defaults a brick-anchored label to offset (2, -2) and switches with the anchor', () => {
    const doc = createDefaultLayoutDoc();
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId="123" viewCentre={{ x: 40, y: 30 }} onClose={() => {}} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('1');
    expect([numberInputs()[1]!.value, numberInputs()[2]!.value]).toEqual(['2', '-2']);
    fireEvent.change(select, { target: { value: '0' } });
    expect([numberInputs()[1]!.value, numberInputs()[2]!.value]).toEqual(['40', '30']);
    fireEvent.change(select, { target: { value: '1' } });
    expect([numberInputs()[1]!.value, numberInputs()[2]!.value]).toEqual(['2', '-2']);
  });

  it('edit mode shows a known colour and keeps it on save (no FF000000 rewrite)', () => {
    const doc = createDefaultLayoutDoc();
    addAnchoredLabel(doc, KNOWN_RED);
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId={null} initialLabel={KNOWN_RED} onClose={() => {}} />);
    const colour = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(colour.value).toBe('#ff0000');
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Depot 2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const [l] = labels(doc);
    expect(l!.id).toBe('77');
    expect(l!.text).toBe('Depot 2');
    expect(l!.color).toEqual({ known: true, argb: 0xffff0000, name: 'Red' });
  });

  it('edit mode writes a newly picked colour as ARGB', () => {
    const doc = createDefaultLayoutDoc();
    addAnchoredLabel(doc, KNOWN_RED);
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId={null} initialLabel={KNOWN_RED} onClose={() => {}} />);
    fireEvent.change(document.querySelector('input[type="color"]')!, { target: { value: '#00ff00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(labels(doc)[0]!.color).toEqual({ known: false, argb: 0xff00ff00, name: '' });
  });
});

describe('AddAnchoredLabelDialog — desktop font and kinds', () => {
  it('defaults to 8.25 pt Microsoft Sans Serif, Regular, and accepts fractional points', () => {
    const doc = createDefaultLayoutDoc();
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId={null} viewCentre={{ x: 0, y: 0 }} onClose={() => {}} />);
    expect((screen.getAllByRole('textbox')[1] as HTMLInputElement).value).toBe('Microsoft Sans Serif');
    expect(numberInputs()[0]!.value).toBe('8.25');
    fireEvent.change(numberInputs()[0]!, { target: { value: '10.5' } });
    fireEvent.change(screen.getAllByRole('textbox')[0]!, { target: { value: 'Pt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Label' }));
    expect(labels(doc)[0]!.font).toEqual({ family: 'Microsoft Sans Serif', size: 10.5, style: 'Regular' });
  });

  it('editing a Group label keeps its kind and target', () => {
    const doc = createDefaultLayoutDoc();
    const group: AnchoredLabel = { ...KNOWN_RED, id: '88', kind: 2, targetId: 'grp' };
    addAnchoredLabel(doc, group);
    render(<AddAnchoredLabelDialog doc={doc} defaultTargetId={null} initialLabel={group} onClose={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('2');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Italic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(labels(doc)[0]).toMatchObject({ kind: 2, targetId: 'grp', font: { style: 'Bold, Italic' } });
  });
});

describe('FindDialog', () => {
  function seeded(): Y.Doc {
    const doc = createDefaultLayoutDoc();
    const lid = brickLayerId(doc);
    placeBrick(doc, lid, { partNumber: '3001.1', x: 0, y: 0, width: 4, height: 2 });
    placeBrick(doc, lid, { partNumber: '3001.1', x: 10, y: 0, width: 4, height: 2 });
    placeBrick(doc, lid, { partNumber: '3001.1', x: 20, y: 0, width: 4, height: 2 });
    return doc;
  }
  const parts = (doc: Y.Doc) =>
    docToBbm(doc).layers.flatMap((l) => (l.type === 'brick' ? l.bricks.map((b) => b.partNumber) : []));

  it('Replace changes only the current match; clicking a result makes it current', () => {
    const doc = seeded();
    const { rerender } = render(<FindDialog map={docToBbm(doc)} doc={doc} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '3001.1' } });
    fireEvent.change(screen.getByPlaceholderText('New part-number text…'), { target: { value: '3001.5' } });
    const results = screen.getAllByRole('listitem');
    expect(results).toHaveLength(3);
    fireEvent.click(results[2]!.querySelector('button')!);
    expect(results[2]!.querySelector('button')!.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(parts(doc)).toEqual(['3001.1', '3001.1', '3001.5']);
    rerender(<FindDialog map={docToBbm(doc)} doc={doc} onClose={() => {}} />);
    expect(screen.getByText('2 matches')).toBeTruthy();
  });

  it('Replace all rewrites every match in one undo step', () => {
    const doc = seeded();
    const um = createUndoManager(doc);
    render(<FindDialog map={docToBbm(doc)} doc={doc} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: '.1' } });
    fireEvent.change(screen.getByPlaceholderText('New part-number text…'), { target: { value: '.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace all' }));
    expect(parts(doc)).toEqual(['3001.7', '3001.7', '3001.7']);
    um.undo();
    expect(parts(doc)).toEqual(['3001.1', '3001.1', '3001.1']);
  });
});

describe('BudgetDialog', () => {
  it('writes an edited limit into the doc', async () => {
    const doc = createDefaultLayoutDoc();
    const lid = brickLayerId(doc);
    placeBrick(doc, lid, { partNumber: '3001.1', x: 0, y: 0, width: 4, height: 2 });
    render(
      <BudgetDialog
        map={docToBbm(doc)}
        limits={readBudgetLimits(doc)}
        onLimitsChange={(next) => setBudgetLimits(doc, next)}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '5' } });
    expect([...readBudgetLimits(doc)]).toEqual([['3001.1', 5]]);
  });
});

describe('ExportImageDialog', () => {
  function handle() {
    const canvas = document.createElement('canvas');
    canvas.toDataURL = vi.fn(() => 'data:,');
    const render = vi.fn(() => ({ canvas, pixelRatio: 1 }));
    const h: ExportHandle = { render, sceneSize: () => ({ width: 400, height: 100 }) };
    return { ref: { current: h }, render, canvas };
  }

  it('defaults to 2x the scene with the height tracking the width', () => {
    const { ref } = handle();
    render(<ExportImageDialog layoutTitle="t" exportImageRef={ref} onClose={() => {}} />);
    const w = screen.getByLabelText('Width (px)') as HTMLInputElement;
    const h = screen.getByLabelText('Height (px)') as HTMLInputElement;
    expect([w.value, h.value]).toEqual(['800', '200']);
    expect(h.disabled).toBe(true);
    fireEvent.change(w, { target: { value: '1000' } });
    expect(h.value).toBe('250');
    fireEvent.click(screen.getByRole('button', { name: '4×' }));
    expect(w.value).toBe('1600');
  });

  it('exports JPEG at the chosen size and quality, without transparency or antialias', () => {
    const { ref, render: renderFn, canvas } = handle();
    render(<ExportImageDialog layoutTitle="t" exportImageRef={ref} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Transparent background'));
    fireEvent.click(screen.getByLabelText('Keep aspect ratio (height auto)'));
    fireEvent.change(screen.getByLabelText('Width (px)'), { target: { value: '640' } });
    fireEvent.change(screen.getByLabelText('Height (px)'), { target: { value: '480' } });
    fireEvent.change(screen.getByDisplayValue('PNG'), { target: { value: 'jpeg' } });
    fireEvent.change(screen.getByLabelText('JPEG quality'), { target: { value: '70' } });
    fireEvent.click(screen.getByLabelText('Antialias'));
    fireEvent.click(screen.getByRole('button', { name: 'Export JPEG' }));
    expect(renderFn).toHaveBeenCalledWith({
      pixelRatio: 1,
      size: { width: 640, height: 480 },
      transparent: false,
      antialias: false,
    });
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('exports a transparent PNG', () => {
    const { ref, render: renderFn, canvas } = handle();
    render(<ExportImageDialog layoutTitle="t" exportImageRef={ref} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Transparent background'));
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    expect(renderFn).toHaveBeenCalledWith({ pixelRatio: 1, size: { width: 800, height: 200 }, transparent: true, antialias: true });
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('refuses a size beyond the canvas limit', () => {
    const { ref } = handle();
    render(<ExportImageDialog layoutTitle="t" exportImageRef={ref} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Width (px)'), { target: { value: '99999' } });
    expect((screen.getByRole('button', { name: 'Export PNG' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
