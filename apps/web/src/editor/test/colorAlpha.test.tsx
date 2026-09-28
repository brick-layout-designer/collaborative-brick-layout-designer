// Colours with alpha (R6/R7): the shared control, and the dialogs that
// use it keeping alpha and named colours.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColorAlphaInput } from '../ColorAlphaInput';
import { colorSpecToArgb, formFromLayer, layerOptionsPatch } from '../layerOptions';
import type { Layer } from '@cld/model';

afterEach(cleanup);

describe('ColorAlphaInput', () => {
  it('a new colour keeps the alpha, a new alpha keeps the colour', () => {
    const onChange = vi.fn();
    render(<ColorAlphaInput label="Colour" value="80112233" onChange={onChange} />);
    fireEvent.input(screen.getByLabelText('Colour'), { target: { value: '#aabbcc' } });
    expect(onChange).toHaveBeenLastCalledWith('80aabbcc');
    fireEvent.change(screen.getByLabelText('Colour alpha'), { target: { value: '255' } });
    expect(onChange).toHaveBeenLastCalledWith('ff112233');
  });
});

describe('colorSpecToArgb', () => {
  it('includes alpha and resolves known colours', () => {
    expect(colorSpecToArgb({ kind: 'argb', argb: '80FF0000' })).toBe('80ff0000');
    expect(colorSpecToArgb({ kind: 'known', name: 'CornflowerBlue' })).toBe('ff6495ed');
  });
});

describe('Layer Options colours carry alpha', () => {
  it('an edited hull colour is written with its alpha; an untouched known colour stays named', () => {
    const layer = {
      type: 'brick', id: 'L', name: 'Bricks', visible: true, transparency: 100,
      hullProperties: { isVisible: true, hullColor: { kind: 'known', name: 'Black' }, hullThickness: 1 },
      displayBrickElevation: false, bricks: [], groups: [],
    } as unknown as Layer;
    const form = formFromLayer(layer);
    expect(form.hullArgb).toBe('ff000000');
    expect(layerOptionsPatch(layer, { ...form, hullThickness: 2 }).hullProperties).toMatchObject({ hullColor: { kind: 'known', name: 'Black' } });
    expect(layerOptionsPatch(layer, { ...form, hullArgb: '40ff0000' }).hullProperties).toMatchObject({ hullColor: { kind: 'argb', argb: '40ff0000' } });
  });
});

describe('Text and ruler dialogs keep alpha and named colours', () => {
  it('Text dialog opens a known colour at its value and saves an edited alpha', async () => {
    const { TextDialog } = await import('../TextDialog');
    const onCommit = vi.fn();
    const initial = {
      displayArea: { x: 0, y: 0, width: 4, height: 2 }, text: 'Hi', orientation: 0,
      font: { family: 'Arial', size: 10, style: 'Regular' }, fontColor: { kind: 'known', name: 'Red' },
      textAlignment: 0,
    } as never;
    render(<TextDialog initial={initial} onClose={() => {}} onCommit={onCommit} />);
    expect((screen.getByLabelText('Text colour') as HTMLInputElement).value).toBe('#ff0000');
    fireEvent.change(screen.getByLabelText('Text colour alpha'), { target: { value: '128' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onCommit.mock.calls[0]![0].colorArgb).toBe('80FF0000');
  });

  it('ruler dialog writes an edited alpha and leaves untouched colours as they were', async () => {
    const Y = await import('yjs');
    const { EditRulerDialog } = await import('../EditRulerDialog');
    const { addLinearRuler, ensureRulerLayer } = await import('../mutations');
    const { createDefaultLayoutDoc, docToBbm } = await import('@cld/ydoc');
    const doc = createDefaultLayoutDoc();
    const layerId = ensureRulerLayer(doc);
    addLinearRuler(doc, layerId, { x: 0, y: 0 }, { x: 10, y: 0 });
    const ruler = () => docToBbm(doc).layers.flatMap((l) => (l.type === 'ruler' ? l.rulerItems : []))[0]!;
    // A known guideline colour must survive an edit of another field.
    doc.transact(() => {
      const items = (doc.getMap('layerData').get(layerId) as InstanceType<typeof Y.Map>).get('rulerItems') as InstanceType<typeof Y.Array<Record<string, unknown>>>;
      const r = items.get(0);
      items.delete(0, 1);
      items.insert(0, [{ ...r, guidelineColor: { kind: 'known', name: 'Gray' } }]);
    });
    render(<EditRulerDialog item={ruler()} layerId={layerId} doc={doc} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Line colour alpha'), { target: { value: '64' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(ruler().color).toEqual({ kind: 'argb', argb: '40000000' });
    expect(ruler().guidelineColor).toEqual({ kind: 'known', name: 'Gray' });
  });
});
