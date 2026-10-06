// Everything drawn over the map that follows parts follows a drag every
// frame, not only the drop: the live pose (liveDragPose.ts) and each
// overlay that reads it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderHook } from '@testing-library/react';
import type { BbmMap, Brick } from '@cld/model';
import type { AnchoredLabel, SidecarModule, Venue } from '@cld/bbm';

type Drawn = { type: string; props: Record<string, unknown> };
let drawn: Drawn[] = [];
vi.mock('react-konva', () => {
  const mk = (type: string) => (p: Record<string, unknown> & { children?: ReactNode }) => {
    drawn.push({ type, props: p });
    return h(Fragment, null, p.children);
  };
  return { Group: mk('Group'), Line: mk('Line'), Text: mk('Text'), Circle: mk('Circle'), Rect: mk('Rect'), Arc: mk('Arc'), Shape: mk('Shape') };
});
vi.mock('konva', () => ({
  default: class {
    static Text = class {
      constructor(private o: { text: string; fontSize: number }) {}
      width() {
        return this.o.text.length * 0.6 * this.o.fontSize;
      }
    };
  },
}));
const electricSeen: BbmMap[] = [];
vi.mock('../render/electricCircuits', async (orig) => ({
  ...(await orig<typeof import('../render/electricCircuits')>()),
  electricOverlay: (map: BbmMap) => {
    electricSeen.push(map);
    return { strokes: [] };
  },
}));

import { posedMap, posedPoint, useLiveDragPose, type DragPose } from '../liveDragPose';
import { ModuleOverlay } from '../render/ModuleOverlay';
import { AnchoredLabels } from '../render/AnchoredLabels';
import { RulerLayers } from '../render/RulerLayer';
import { ElectricCircuitLayer } from '../render/ElectricCircuitLayer';
import { RemoteCursors } from '../render/RemoteCursors';
import { ridingAnno } from '../render/BrickLayer';
import { useLiveVenueReadout } from '../liveVenueReadout';
import { useEditorStore } from '../editorStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const brick = (id: string, x: number, y: number): Brick =>
  ({ id, partNumber: 'p', displayArea: { x, y, width: 4, height: 2 }, orientation: 0, myGroup: '', connexions: [], altitude: 0, activeConnectionPointIndex: 0 }) as unknown as Brick;
const MAP = {
  layers: [
    { id: 'L', type: 'brick', visible: true, transparency: 100, bricks: [brick('a', 0, 0), brick('b', 4, 0), brick('c', 100, 100)] },
    {
      id: 'R',
      type: 'ruler',
      visible: true,
      transparency: 100,
      rulerItems: [
        { id: 'r1', kind: 'linear', point1: { x: 2, y: 1 }, point2: { x: 102, y: 101 }, attachedBrick1Id: 'a', attachedBrick2Id: '', offsetDistance: 0, allowOffset: false, guidelineDashPattern: [], guidelineColor: { kind: 'known', name: 'Black' }, guidelineThickness: 1, color: { kind: 'known', name: 'Black' }, lineThickness: 1, displayDistance: false, displayUnit: false, unit: 0, measureFont: { family: 'Arial', size: 8, style: '' }, measureFontColor: { kind: 'known', name: 'Black' }, displayArea: { x: 2, y: 1, width: 100, height: 100 } },
      ],
    },
  ],
} as unknown as BbmMap;
const moving = new Set(['a', 'b']);
const startAreas = new Map([
  ['a', { x: 0, y: 0, width: 4, height: 2 }],
  ['b', { x: 4, y: 0, width: 4, height: 2 }],
]);
/** Dragged 10 studs right and 20 down. */
const SHIFT: DragPose = { ids: moving, startAreas, about: { x: 0, y: 0 }, to: { x: 10, y: 20 }, degrees: 0 };
const area = (m: BbmMap, id: string) => {
  for (const l of m.layers) if (l.type === 'brick') for (const b of l.bricks) if (b.id === id) return b.displayArea;
  return undefined;
};

async function draw(el: ReturnType<typeof h>) {
  drawn = [];
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(el));
  return root;
}

afterEach(() => {
  useLiveDragPose.setState({ pose: null });
  useEditorStore.setState({ selection: [], showModuleNames: true });
});

describe('the live pose', () => {
  it('moves and turns a start-of-drag point', () => {
    expect(posedPoint(SHIFT, 1, 2)).toEqual({ x: 11, y: 22 });
    const turn: DragPose = { ...SHIFT, about: { x: 0, y: 0 }, to: { x: 0, y: 0 }, degrees: 90 };
    const p = posedPoint(turn, 1, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it('moves the dragged parts in the map overlays draw from, and nothing else', () => {
    const m = posedMap(MAP, SHIFT);
    expect(area(m, 'a')).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    expect(area(m, 'b')).toEqual({ x: 14, y: 20, width: 4, height: 2 });
    expect(area(m, 'c')).toBe(area(MAP, 'c'));
    expect(posedMap(MAP, null)).toBe(MAP);
  });

  it('turns them too (snapping turns a dragged group)', () => {
    const turn: DragPose = { ...SHIFT, about: { x: 2, y: 1 }, to: { x: 2, y: 1 }, degrees: 90 };
    const m = posedMap(MAP, turn);
    const a = area(m, 'a')!;
    expect([a.width, a.height]).toEqual([2, 4]);
    expect(a.x + a.width / 2).toBeCloseTo(2);
    const b = m.layers[0]!.type === 'brick' ? m.layers[0]!.bricks[1]! : null;
    expect(b!.orientation).toBe(90);
  });

  it('stops once the drop is in the layout (or another edit moved the part)', () => {
    const dropped = posedMap(MAP, { ...SHIFT, startAreas: new Map([['a', { x: 1, y: 0, width: 4, height: 2 }]]) });
    expect(dropped).toBe(MAP);
  });

  it('rulers and labels fixed to a dragged part ride the pose, not the shift', () => {
    const anno = { rulers: ['r1', 'r2'], labels: ['l1', 'l2'], texts: [] };
    const labels = [
      { id: 'l1', kind: 1, targetId: 'a' },
      { id: 'l2', kind: 0, targetId: '' },
    ];
    expect(ridingAnno(anno, moving, MAP, labels)).toEqual({ rulers: ['r2'], labels: ['l2'], texts: [] });
  });
});

describe('overlays follow the drag before the drop', () => {
  const modules: SidecarModule[] = [{ id: 'm', name: 'Yard', members: ['a', 'b'], transform: [1, 0, 0, 0, 1, 0, 0, 0, 1] }];

  it('module outline and name', async () => {
    const frameX = () => drawn.filter((d) => d.props.name === 'module-frame').at(-1)!.props.x as number;
    const root = await draw(h(ModuleOverlay, { map: MAP, modules }));
    const before = frameX();
    await act(async () => useLiveDragPose.getState().setPose(SHIFT));
    expect(frameX()).toBe(before + 10 * 8);
    await act(async () => root.unmount());
  });

  it('a module picked whole is highlighted as one piece', async () => {
    useEditorStore.setState({ selection: ['a', 'b'] });
    const root = await draw(h(ModuleOverlay, { map: MAP, modules }));
    expect(drawn.some((d) => String(d.props.name).startsWith('module-selected'))).toBe(true);
    await act(async () => root.unmount());
    useEditorStore.setState({ selection: ['a'] });
    const root2 = await draw(h(ModuleOverlay, { map: MAP, modules }));
    expect(drawn.some((d) => String(d.props.name).startsWith('module-selected'))).toBe(false);
    await act(async () => root2.unmount());
  });

  it('labels fixed to parts', async () => {
    const label = { id: 'l1', text: 'Here', font: { family: 'Arial', size: 10, style: '' }, color: { known: true, argb: 0, name: 'Black' }, kind: 1, targetId: 'a', offset: { x: 0, y: 0 }, rot: 0, minZoom: 0 } as AnchoredLabel;
    const textX = () => drawn.filter((d) => d.type === 'Text').at(-1)!.props.x as number;
    const root = await draw(h(AnchoredLabels, { map: MAP, labels: [label], zoom: 1 }));
    const before = textX();
    await act(async () => useLiveDragPose.getState().setPose(SHIFT));
    expect(textX()).toBeCloseTo(before + 80);
    await act(async () => root.unmount());
  });

  it('rulers fixed to parts', async () => {
    const pts = () => JSON.stringify(drawn.filter((d) => d.type === 'Line').map((d) => d.props.points));
    const root = await draw(h(RulerLayers, { map: MAP, selectedRulerIds: new Set<string>(), onRulerSelect: () => undefined }));
    const before = pts();
    await act(async () => useLiveDragPose.getState().setPose(SHIFT));
    expect(pts()).not.toBe(before);
    await act(async () => root.unmount());
  });

  it('electric circuits', async () => {
    electricSeen.length = 0;
    const root = await draw(h(ElectricCircuitLayer, { map: MAP, partsByKey: new Map() }));
    await act(async () => useLiveDragPose.getState().setPose(SHIFT));
    expect(area(electricSeen.at(-1)!, 'a')).toEqual({ x: 10, y: 20, width: 4, height: 2 });
    await act(async () => root.unmount());
  });

  it('others’ selections of the dragged parts', async () => {
    const states = new Map<number, unknown>([
      [2, { user: { id: 'u', displayName: 'Sam', avatarUrl: null, color: '#f00' }, cursor: null, selection: { brickIds: ['a'] }, tool: 'select', lastActivityMs: Date.now() }],
    ]);
    const awareness = { clientID: 1, getStates: () => states, on: () => undefined, off: () => undefined } as never;
    const rectX = () => drawn.filter((d) => d.type === 'Rect').at(-1)!.props.x as number;
    const root = await draw(h(RemoteCursors, { awareness, map: MAP }));
    const before = rectX();
    await act(async () => useLiveDragPose.getState().setPose(SHIFT));
    expect(rectX()).toBeCloseTo(before + 80);
    await act(async () => root.unmount());
  });

  it('venue warnings', () => {
    const venue = {
      name: 'Hall',
      enabled: true,
      minWalkwayStuds: 0,
      bounds: { x: 0, y: 0, w: 50, h: 50 },
      edges: [{ kind: 0, doorWidthStuds: 0, label: '', poly: [{ x: -1, y: -1 }, { x: 50, y: -1 }, { x: 50, y: 50 }, { x: -1, y: 50 }, { x: -1, y: -1 }] }],
      obstacles: [],
    } as unknown as Venue;
    const inside = { layers: [MAP.layers[0]!].map((l) => (l.type === 'brick' ? { ...l, bricks: l.bricks.slice(0, 2) } : l)) } as BbmMap;
    const { result, rerender } = renderHook(() => useLiveVenueReadout(venue, inside));
    expect(result.current?.ok).toBe(true);
    // Dragged outside the room: the warning shows before the drop.
    act(() => useLiveDragPose.getState().setPose({ ...SHIFT, to: { x: 200, y: 200 } }));
    rerender();
    expect(result.current?.ok).toBe(false);
  });
});
