// @vitest-environment jsdom
// Modules and sheets: saving keeps each part's sheet (with its fade) or
// puts them all on one; adding a module matches sheets by name and asks
// "Where should these go?" for the rest, never making a surprise sheet;
// a module with parts on hidden sheets says so.

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as Y from 'yjs';
import type { BbmMap } from '@cld/model';
import type { SidecarModule } from '@cld/bbm';
import { docToBbm, readSidecarFromDoc, seedFromBbm } from '@cld/ydoc';
import { addLayer, importBricksAsModule, placeBrick, renameLayer, setLayerTransparency, setLayerVisible, type ModuleBatch } from '../mutations';
import {
  defaultChoices,
  findPartsSheet,
  hiddenSheetsNote,
  moduleMapFromSelection,
  moduleSheetsUsed,
  oneSheetName,
  pickedBySheet,
  pickedPartsSheet,
  repairModuleSheets,
  unmatchedSheets,
} from '../moduleSheets';
import { chooseModuleSheets, closeSheetQuestion, placeModuleAsking, SheetChoiceHost } from '../SheetChoiceDialog';
import { useEditorStore } from '../editorStore';
import { moduleLabelLayouts } from '../render/moduleLabels';
import { ModuleEditBar } from '../ModuleEditBar';
import { canDragPart, pinnedAmong, withPinned } from '../moduleEdit';

afterEach(() => {
  act(() => closeSheetQuestion());
  cleanup();
  useEditorStore.setState({ activeLayerId: null, editingModuleId: null });
});

/** A layout with parts sheets named `names` (bottom first), two parts on each. */
function layout(names: string[]) {
  const doc = new Y.Doc();
  const ids: Record<string, string> = {};
  const parts: Record<string, string[]> = {};
  names.forEach((name, i) => {
    const id = addLayer(doc, 'brick');
    renameLayer(doc, id, name);
    ids[name] = id;
    parts[name] = [
      placeBrick(doc, id, { partNumber: '3001', x: i * 10, y: 0, width: 4, height: 2 }),
      placeBrick(doc, id, { partNumber: '3001', x: i * 10 + 4, y: 0, width: 4, height: 2 }),
    ];
  });
  return { doc, ids, parts, map: () => docToBbm(doc) };
}

const batch = (layerName: string, n = 1): ModuleBatch => ({
  layerName,
  bricks: Array.from({ length: n }, (_, i) => ({ partNumber: '3001', displayArea: { x: i * 4, y: 0, width: 4, height: 2 } })),
});

const sheetOf = (map: BbmMap, brickId: string) =>
  map.layers.find((l) => l.type === 'brick' && l.bricks.some((b) => b.id === brickId))!;

describe('saving a module', () => {
  it("keeps each part's sheet, with the sheet's fade and always shown (never see-through)", () => {
    const { doc, ids, parts, map } = layout(['Track', 'Buildings']);
    setLayerTransparency(doc, ids.Buildings!, 60);
    setLayerVisible(doc, ids.Track!, false);
    const built = moduleMapFromSelection(map(), [...parts.Track!, parts.Buildings![0]!])!;
    expect(built.count).toBe(3);
    expect(built.moduleMap.layers.map((l) => [l.name, l.transparency, l.visible, l.type === 'brick' ? l.bricks.length : -1])).toEqual([
      ['Track', 100, true, 2],
      ['Buildings', 60, true, 1],
    ]);
    // Centred on (0, 0).
    const all = built.moduleMap.layers.flatMap((l) => (l.type === 'brick' ? l.bricks : []));
    const cx = all.reduce((s, b) => s + b.displayArea.x + b.displayArea.width / 2, 0) / all.length;
    expect(cx).toBeCloseTo(0, 9);
    expect(built.region).toEqual({ x: -1, y: -1, width: 16, height: 4 });
  });

  it('puts everything on one sheet named after the sheet with the most parts', () => {
    const { parts, map } = layout(['Track', 'Buildings']);
    const sel = [parts.Track![0]!, ...parts.Buildings!];
    expect(oneSheetName(pickedBySheet(map(), sel))).toBe('Buildings');
    const built = moduleMapFromSelection(map(), sel, { oneSheet: true })!;
    expect(built.moduleMap.layers).toHaveLength(1);
    expect(built.moduleMap.layers[0]!).toMatchObject({ name: 'Buildings', transparency: 100, visible: true });
    expect((built.moduleMap.layers[0] as { bricks: unknown[] }).bricks).toHaveLength(3);
    // One sheet already: nothing changes.
    expect(moduleMapFromSelection(map(), parts.Track!, { oneSheet: true })!.moduleMap.layers.map((l) => l.name)).toEqual(['Track']);
    expect(moduleMapFromSelection(map(), [])).toBeNull();
  });

  it('mends a module an older build saved see-through, and leaves other sheets alone', () => {
    const { parts, map } = layout(['Track']);
    const built = moduleMapFromSelection(map(), parts.Track!)!;
    const old = seedFromBbm({
      ...built.moduleMap,
      layers: [
        { ...built.moduleMap.layers[0]!, transparency: 0 },
        { ...built.moduleMap.layers[0]!, id: 'module-layer-1', transparency: 40 },
        { ...built.moduleMap.layers[0]!, id: 'mine', transparency: 0 },
      ],
    });
    expect(repairModuleSheets(old)).toBe(1);
    expect(docToBbm(old).layers.map((l) => l.transparency)).toEqual([100, 40, 0]);
    expect(repairModuleSheets(old)).toBe(0);
  });
});

describe('matching sheets', () => {
  it('matches names ignoring case and spaces at either end, parts sheets only', () => {
    const { map } = layout(['Track ', 'Buildings']);
    const m = map();
    expect(findPartsSheet(m.layers, ' track')).toBe(m.layers.find((l) => l.name === 'Track ')!.id);
    expect(findPartsSheet(m.layers, 'Trees')).toBeNull();
    const withText = { layers: [...m.layers, { id: 't', name: 'Trees', type: 'text' as const }] };
    expect(findPartsSheet(withText.layers, 'Trees')).toBeNull();
    expect(unmatchedSheets(m, [batch('TRACK', 2), batch('Trees', 3), batch('trees ', 1), batch('Empty', 0)])).toEqual([{ name: 'Trees', parts: 4 }]);
  });

  it('defaults to the picked parts sheet, the top parts sheet, or a new sheet when there are none', () => {
    const { ids, map } = layout(['Track', 'Buildings']);
    expect(pickedPartsSheet(map(), ids.Track!)).toBe(ids.Track);
    expect(pickedPartsSheet(map(), null)).toBe(ids.Buildings);
    expect(pickedPartsSheet({ layers: [] }, null)).toBeNull();
    expect(defaultChoices([{ name: 'Trees', parts: 1 }], ids.Track!)).toEqual({ Trees: { layerId: ids.Track } });
    expect(defaultChoices([{ name: 'Trees', parts: 1 }], null)).toEqual({ Trees: { newName: 'Trees' } });
  });
});

describe('adding a module', () => {
  it('puts matching sheets on their match, and the rest where the answer says, with no surprise sheet', () => {
    const { doc, ids, map } = layout(['Track', 'Buildings']);
    const res = importBricksAsModule(doc, [batch('track', 2), batch('Trees', 1), batch('Signals', 1)], {
      name: 'Yard',
      sheets: { Trees: { layerId: ids.Buildings! }, Signals: { newName: 'Signals' } },
    })!;
    const m = map();
    expect(m.layers.filter((l) => l.type === 'brick').map((l) => l.name)).toEqual(['Track', 'Buildings', 'Signals']);
    expect(res.ids.map((id) => sheetOf(m, id).name)).toEqual(['Track', 'Track', 'Buildings', 'Signals']);
    // One module, one undo step's worth of members.
    expect(readSidecarFromDoc(doc)!.modules!.find((x) => x.id === res.moduleId)!.members).toEqual(res.ids);
  });

  it('shares one new sheet between module sheets sent to the same new name, and reuses an existing one', () => {
    const { doc, map } = layout(['Track']);
    importBricksAsModule(doc, [batch('A'), batch('B')], { name: 'M', sheets: { A: { newName: 'Extra' }, B: { newName: 'extra' } } });
    expect(map().layers.filter((l) => l.type === 'brick').map((l) => l.name)).toEqual(['Track', 'Extra']);
    importBricksAsModule(doc, [batch('C')], { name: 'M', sheets: { C: { newName: 'Track' } } });
    expect(map().layers.filter((l) => l.type === 'brick').map((l) => l.name)).toEqual(['Track', 'Extra']);
  });
});

describe('Where should these go?', () => {
  it("doesn't ask when every sheet matches", async () => {
    const { map } = layout(['Track']);
    await expect(chooseModuleSheets(map(), [batch('Track')], 'Yard')).resolves.toEqual({});
  });

  it('asks even for a one-sheet module, starts at the picked sheet, and offers a new sheet by its name', async () => {
    const { doc, ids, map } = layout(['Track', 'Buildings']);
    useEditorStore.setState({ activeLayerId: ids.Track! });
    render(<SheetChoiceHost />);
    const placed = placeModuleAsking(doc, [batch('Trees', 3)], { name: 'Park' });
    const dlg = await screen.findByTestId('sheet-choice-dialog');
    expect(dlg.textContent).toContain('“Park” uses a sheet. Your layout doesn’t have “Trees”.');
    expect(dlg.textContent).toContain('Trees (3 parts)');
    const select = within(dlg).getByRole('combobox', { name: 'Where the parts on Trees go' }) as HTMLSelectElement;
    expect(select.value).toBe(ids.Track);
    expect([...select.options].map((o) => o.textContent)).toEqual(['Buildings', 'Track (picked sheet)', 'A new sheet named “Trees”']);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Place' }));
    const res = (await placed)!;
    expect(res.ids.every((id) => sheetOf(map(), id).id === ids.Track)).toBe(true);
    expect(map().layers).toHaveLength(2);
    expect(screen.queryByTestId('sheet-choice-dialog')).toBeNull();
  });

  it('makes the new sheet when picked, for each unmatched sheet separately', async () => {
    const { doc, ids, map } = layout(['Track']);
    render(<SheetChoiceHost />);
    const placed = placeModuleAsking(doc, [batch('Track'), batch('Trees'), batch('Water')], { name: 'Park' });
    const dlg = await screen.findByTestId('sheet-choice-dialog');
    expect(dlg.textContent).toContain('uses 3 sheets. Your layout doesn’t have “Trees” or “Water”.');
    fireEvent.change(within(dlg).getByRole('combobox', { name: 'Where the parts on Water go' }), { target: { value: '__new__' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Place' }));
    const res = (await placed)!;
    const m = map();
    expect(res.ids.map((id) => sheetOf(m, id).name)).toEqual(['Track', 'Track', 'Water']);
    expect(sheetOf(m, res.ids[1]!).id).toBe(ids.Track);
  });

  it('puts nothing down on Cancel or Esc', async () => {
    const { doc, map } = layout(['Track']);
    const before = map().layers.flatMap((l) => (l.type === 'brick' ? l.bricks : [])).length;
    render(<SheetChoiceHost />);
    for (const how of ['cancel', 'esc'] as const) {
      const placed = placeModuleAsking(doc, [batch('Trees')], { name: 'Park' });
      const dlg = await screen.findByTestId('sheet-choice-dialog');
      if (how === 'cancel') fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
      else fireEvent.keyDown(dlg, { key: 'Escape' });
      await expect(placed).resolves.toBeNull();
      await waitFor(() => expect(screen.queryByTestId('sheet-choice-dialog')).toBeNull());
    }
    expect(map().layers.flatMap((l) => (l.type === 'brick' ? l.bricks : [])).length).toBe(before);
    expect(readSidecarFromDoc(doc)?.modules ?? []).toHaveLength(0);
  });
});

describe('a module with parts on hidden sheets', () => {
  const measure = (t: string) => (f: number) => t.length * 0.6 * f;

  it('frames the parts that show with sparser dashes, and says so in the Modules panel', () => {
    const { doc, ids, parts, map } = layout(['Track', 'Buildings']);
    const mod = { id: 'm', name: 'Yard', members: [...parts.Track!, ...parts.Buildings!] } as unknown as SidecarModule;
    const [whole] = moduleLabelLayouts(map(), [mod], 100, measure);
    expect(whole!.partlyHidden).toBe(false);
    expect(hiddenSheetsNote(moduleSheetsUsed(map(), mod.members))).toBeNull();

    setLayerVisible(doc, ids.Buildings!, false);
    const [part] = moduleLabelLayouts(map(), [mod], 100, measure);
    expect(part!.partlyHidden).toBe(true);
    // Only the Track parts (x 0..8) are framed.
    expect(part!.frame.width).toBeLessThan(whole!.frame.width);
    expect(hiddenSheetsNote(moduleSheetsUsed(map(), mod.members))).toBe('2 parts are on a hidden sheet');

    setLayerVisible(doc, ids.Track!, false);
    expect(moduleLabelLayouts(map(), [mod], 100, measure)).toEqual([]);
    expect(hiddenSheetsNote(moduleSheetsUsed(map(), mod.members))).toBe('hidden: its sheets are hidden');
    // A module on visible sheets next to hidden ones isn't "partly hidden".
    setLayerVisible(doc, ids.Track!, true);
    const trackOnly = { ...mod, id: 't', members: parts.Track! } as SidecarModule;
    expect(moduleLabelLayouts(map(), [trackOnly], 100, measure)[0]!.partlyHidden).toBe(false);
  });

  it('Edit module says which sheet new parts go on, and shows hidden sheets again', () => {
    const { doc, ids, parts, map } = layout(['Track', 'Buildings']);
    const res = importBricksAsModule(doc, [batch('Track'), batch('Buildings')], { name: 'Yard' })!;
    void parts;
    setLayerVisible(doc, ids.Buildings!, false);
    useEditorStore.setState({ editingModuleId: res.moduleId, activeLayerId: ids.Track! });
    render(<ModuleEditBar doc={doc} awareness={null} />);
    const hint = screen.getByTestId('module-edit-sheets');
    expect(hint.textContent).toContain('This module uses 2 sheets. New parts go on Track (the picked sheet).');
    expect(hint.textContent).toContain('1 of its sheets is hidden.');
    fireEvent.click(within(hint).getByRole('button', { name: 'Show it' }));
    expect(map().layers.find((l) => l.id === ids.Buildings)!.visible).toBe(true);
  });

  it('Pin in place holds every part of a module, whatever sheet it is on', () => {
    const { doc } = layout(['Track', 'Buildings']);
    const res = importBricksAsModule(doc, [batch('Track'), batch('Buildings')], { name: 'Yard' })!;
    const mod = withPinned(readSidecarFromDoc(doc)!.modules!.find((m) => m.id === res.moduleId)!, true);
    const m = docToBbm(doc);
    expect(new Set(res.ids.map((id) => sheetOf(m, id).name))).toEqual(new Set(['Track', 'Buildings']));
    for (const id of res.ids) {
      expect(pinnedAmong([id], [mod], null)?.id).toBe(res.moduleId);
      expect(canDragPart(id, [mod], null)).toBe(false);
    }
  });
});
