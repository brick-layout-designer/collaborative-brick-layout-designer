// A placed module's own look: colours stored per module, the "Same colour"
// link, Reset to default and Show name (moduleLook.ts), written to the
// shared layout so everyone sees them (mutations.ts updateSidecarModule).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SidecarModule } from '@cld/bbm';
import { readSidecarFromDoc } from '@cld/ydoc';
import {
  MODULE_DEFAULT_COLOUR,
  coloursLinked,
  hasCustomColours,
  moduleColour,
  withColour,
  withDefaultColours,
  withSameColour,
  withShowName,
} from '../moduleLook';
import { createSidecarModule, updateSidecarModule } from '../mutations';
import { moduleLook } from '../render/moduleLabels';

const base: SidecarModule = { id: 'm', name: 'Harbour', members: ['b'], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

describe('module colours', () => {
  it('starts with the default look, linked', () => {
    expect(coloursLinked(base)).toBe(true);
    expect(hasCustomColours(base)).toBe(false);
    expect(moduleColour(base, 'outline')).toBe(MODULE_DEFAULT_COLOUR);
    expect(moduleColour(base, 'name')).toBe(MODULE_DEFAULT_COLOUR);
  });

  it('with Same colour on, setting either colour sets both', () => {
    const a = withColour(base, 'outline', '#FF8800');
    expect(a.outlineColor).toBe('#ff8800');
    expect(a.nameColor).toBe('#ff8800');
    const b = withColour(a, 'name', '#00aa00');
    expect([b.outlineColor, b.nameColor]).toEqual(['#00aa00', '#00aa00']);
    expect(hasCustomColours(b)).toBe(true);
  });

  it('with Same colour off, each colour is set on its own', () => {
    const off = withSameColour(withColour(base, 'outline', '#ff8800'), false);
    expect(off.sameColor).toBe(false);
    const a = withColour(off, 'name', '#112233');
    expect([a.outlineColor, a.nameColor]).toEqual(['#ff8800', '#112233']);
    const b = withColour(a, 'outline', '#445566');
    expect([b.outlineColor, b.nameColor]).toEqual(['#445566', '#112233']);
  });

  it('turning Same colour back on gives the name the outline colour', () => {
    const split = withColour(withSameColour(withColour(base, 'outline', '#ff8800'), false), 'name', '#112233');
    const on = withSameColour(split, true);
    expect(on.sameColor).toBeUndefined();
    expect([on.outlineColor, on.nameColor]).toEqual(['#ff8800', '#ff8800']);
    // With no outline colour chosen, both go back to the default.
    const nameOnly = withSameColour(withColour(withSameColour(base, false), 'name', '#112233'), true);
    expect(nameOnly.nameColor).toBeUndefined();
    expect(nameOnly.outlineColor).toBeUndefined();
  });

  it('Reset to default removes both colours and the link setting', () => {
    const custom = withColour(withSameColour(withColour(base, 'outline', '#ff8800'), false), 'name', '#112233');
    const reset = withDefaultColours(custom);
    expect(reset).toEqual(base);
    expect(hasCustomColours(withSameColour(base, false))).toBe(true);
    expect(moduleLook(reset)).toEqual(moduleLook(base));
  });

  it('Show name is stored only when the name is hidden', () => {
    const hidden = withShowName(base, false);
    expect(hidden.showName).toBe(false);
    expect(moduleLook(hidden).showName).toBe(false);
    expect(withShowName(hidden, true)).toEqual(base);
  });
});

describe('module look in the shared layout', () => {
  it('is saved on the module in the sidecar and leaves the others alone', () => {
    const doc = new Y.Doc();
    const a = createSidecarModule(doc, 'A', ['b1'])!;
    const b = createSidecarModule(doc, 'B', ['b2'])!;
    updateSidecarModule(doc, a, (m) => withColour(m, 'outline', '#ff8800'));
    updateSidecarModule(doc, a, (m) => withShowName(m, false));
    const mods = readSidecarFromDoc(doc)!.modules!;
    const ma = mods.find((m) => m.id === a)!;
    expect([ma.outlineColor, ma.nameColor, ma.showName]).toEqual(['#ff8800', '#ff8800', false]);
    const mb = mods.find((m) => m.id === b)!;
    expect(mb.outlineColor).toBeUndefined();
    expect(mb.showName).toBeUndefined();
  });

  it('reaches another copy of the layout (live sync)', () => {
    const one = new Y.Doc();
    const two = new Y.Doc();
    one.on('update', (u: Uint8Array) => Y.applyUpdate(two, u));
    const id = createSidecarModule(one, 'A', ['b1'])!;
    updateSidecarModule(one, id, (m) => withColour(m, 'name', '#123456'));
    expect(readSidecarFromDoc(two)!.modules![0]!.nameColor).toBe('#123456');
  });

  it('does nothing for a module that is gone', () => {
    const doc = new Y.Doc();
    createSidecarModule(doc, 'A', ['b1']);
    const before = JSON.stringify(readSidecarFromDoc(doc));
    let updates = 0;
    doc.on('update', () => updates++);
    updateSidecarModule(doc, 'nope', (m) => withShowName(m, false));
    expect(JSON.stringify(readSidecarFromDoc(doc))).toBe(before);
    expect(updates).toBe(0);
  });
});
