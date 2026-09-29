// Drawing the venue model v2 parts (references/VENUE-MODEL.md, "Drawing"):
// the shared geometry (the desktop's VenueDraw test checks the same
// numbers) and what the overlay draws for the Grand Lobby fixture.

import { describe, expect, it, vi } from 'vitest';
import { act, createElement as h, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

type Drawn = { type: string; props: Record<string, unknown> };
let drawn: Drawn[] = [];
vi.mock('react-konva', () => {
  const mk = (type: string) => (p: Record<string, unknown> & { children?: ReactNode }) => {
    drawn.push({ type, props: p });
    return h(Fragment, null, p.children);
  };
  return { Group: mk('Group'), Line: mk('Line'), Text: mk('Text'), Circle: mk('Circle'), Rect: mk('Rect') };
});

import GRAND_LOBBY from '../../../../../packages/bbm/tests/fixtures/grand-lobby.bld-venue?raw';
import { parseVenueFile } from '../venueFile';
import { VenueOverlay } from '../render/VenueOverlay';
import { dimensionGeometry, elevatorCross, obstacleStyle, powerText, stairMarks } from '../render/venueDraw';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('venue drawing geometry', () => {
  it('draws treads across stairs and an arrow pointing the way up', () => {
    // 40 wide (x) by 30 deep (y), up to the north.
    const stairs = { poly: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }, { x: 0, y: 30 }], upDegrees: 270 };
    const { treads, arrow } = stairMarks(stairs);
    // Every 10 studs along the way up, full width.
    expect(treads.map((t) => t.map((v) => Math.round(v) + 0))).toEqual([
      [0, 20, 40, 20],
      [0, 10, 40, 10],
    ]);
    const [tailX, tailY, tipX, tipY] = arrow[0]!.map((v) => Math.round(v * 100) / 100);
    expect([tailX, tipX]).toEqual([20, 20]);
    expect(tipY).toBeLessThan(tailY!); // points north
    expect(stairMarks({ poly: stairs.poly })).toEqual({ treads: [], arrow: [] });
  });

  it('crosses elevators, labels power and places measurement labels above the line', () => {
    expect(elevatorCross([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }])).toEqual([
      [0, 0, 4, 2],
      [4, 0, 0, 2],
    ]);
    expect(powerText({ label: 'Stage', amps: 20, volts: 120 })).toBe('Stage · 20 A · 120 V');
    expect(powerText({})).toBe('');
    const g = dimensionGeometry({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } })!;
    expect(g.ticks.map((t) => t.map((v) => v + 0))).toEqual([
      [0, -5, 0, 5],
      [100, -5, 100, 5],
    ]);
    expect(g.label).toEqual({ x: 50, y: -8 });
    expect(g.angleDeg).toBe(0);
    // Right to left still reads left to right.
    expect(dimensionGeometry({ from: { x: 100, y: 0 }, to: { x: 0, y: 0 } })!.angleDeg).toBe(0);
    expect(dimensionGeometry({ from: { x: 1, y: 1 }, to: { x: 1, y: 1 } })).toBeNull();
    expect(obstacleStyle('railing').fill).toBeNull();
    expect(obstacleStyle(undefined)).toEqual(obstacleStyle('fountain' as never));
  });
});

describe('VenueOverlay', () => {
  it('draws the Grand Lobby: power, notes, measurements, estimates', async () => {
    drawn = [];
    const venue = parseVenueFile(GRAND_LOBBY);
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(h(VenueOverlay, { venue })));

    const circles = drawn.filter((d) => d.type === 'Circle');
    expect(circles).toHaveLength(venue.power!.length);
    expect(circles.filter((c) => c.props.fill !== 'white')).toHaveLength(3); // floor outlets are filled
    const texts = drawn.filter((d) => d.type === 'Text').map((d) => String(d.props.text));
    expect(texts).toContain('Concessions entrance is on the floor above');
    expect(texts.some((t) => t.startsWith('East of the stairs') && t.endsWith('(est.)'))).toBe(true);
    expect(texts).toContain('20′');
    expect(texts).toContain('≈ 57′ (est.)');
    expect(texts.some((t) => t.startsWith('angled north-east wall') && t.endsWith('(est.)'))).toBe(true);
    // Estimated outline edges are faded.
    expect(drawn.filter((d) => d.type === 'Line' && d.props.opacity === 0.45)).toHaveLength(3);
    // The railing is an outline only.
    expect(drawn.some((d) => d.type === 'Line' && d.props.closed && d.props.fill === undefined && d.props.strokeWidth === 3)).toBe(true);
    await act(async () => root.unmount());
  });
});
