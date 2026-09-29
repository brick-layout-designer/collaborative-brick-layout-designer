// New rulers like desktop (RulerItem.h:22-31, FontSpec.h:11-12,
// MapView.cpp:818-829 and 941-946).

import { describe, expect, it } from 'vitest';
import { createDefaultLayoutDoc, docToBbm } from '@cld/ydoc';
import { addCircularRuler, addLayer, addLinearRuler, ensureRulerLayer, rulerPreviewLabel } from '../mutations';

describe('new rulers', () => {
  it('black (known) line, guideline and text, 1-thick solid lines, Microsoft Sans Serif 8.25', () => {
    const doc = createDefaultLayoutDoc();
    const layer = ensureRulerLayer(doc);
    addLinearRuler(doc, layer, { x: 0, y: 0 }, { x: 10, y: 0 });
    addCircularRuler(doc, layer, { x: 0, y: 0 }, 5);
    const items = docToBbm(doc).layers.flatMap((l) => (l.type === 'ruler' ? l.rulerItems : []));
    expect(items).toHaveLength(2);
    for (const r of items) {
      expect(r).toMatchObject({
        color: { kind: 'known', name: 'Black' },
        lineThickness: 1,
        guidelineColor: { kind: 'known', name: 'Black' },
        guidelineThickness: 1,
        guidelineDashPattern: [],
        measureFont: { family: 'Microsoft Sans Serif', size: 8.25, style: 'Regular' },
        measureFontColor: { kind: 'known', name: 'Black' },
      });
    }
  });

  it('go on the first ruler layer, or a new one named Rulers', () => {
    const doc = createDefaultLayoutDoc();
    const first = ensureRulerLayer(doc);
    expect(docToBbm(doc).layers.find((l) => l.id === first)?.name).toBe('Rulers');
    addLayer(doc, 'ruler');
    expect(ensureRulerLayer(doc)).toBe(first);
  });

  it('the drawing preview reads studs and mm / m, with r= for circles', () => {
    expect(rulerPreviewLabel(20, false)).toBe('20.0 studs (160 mm)');
    expect(rulerPreviewLabel(125, false)).toBe('125.0 studs (1.00 m)');
    expect(rulerPreviewLabel(6.25, true)).toBe('r=6.3 studs (50 mm)');
  });
});
