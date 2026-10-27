// A turn (R) in the middle of a drag (brickDrag.ts): the drag drops the
// parts where they are, and picks up again once they're drawn turned —
// only for a mouse, only while it's still down, only once.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type Konva from 'konva';
import { brickDrag } from '../brickDrag';

const node = () => ({ stopDrag: vi.fn() }) as unknown as Konva.Node & { stopDrag: ReturnType<typeof vi.fn> };

describe('a turn in the middle of a drag', () => {
  afterEach(() => {
    brickDrag.takeResume('a');
    brickDrag.takeResume('b');
  });

  it('does nothing when nothing is being dragged', () => {
    expect(brickDrag.active()).toBe(false);
    expect(brickDrag.dropForTurn()).toBe(false);
    expect(brickDrag.takeResume('a')).toBe(false);
  });

  it('drops the dragged part, then picks its drag up again once, when it is drawn', () => {
    const n = node();
    brickDrag.started(n, 'a', true);
    expect(brickDrag.active()).toBe(true);
    expect(brickDrag.dropForTurn()).toBe(true);
    // No event: a key press has no pointer for Konva to read.
    expect(n.stopDrag).toHaveBeenCalledWith();
    expect(brickDrag.active()).toBe(false);
    expect(brickDrag.takeResume('b')).toBe(false); // another part drawn
    expect(brickDrag.takeResume('a')).toBe(true);
    expect(brickDrag.takeResume('a')).toBe(false); // once
  });

  it('a finger’s drag ends with the turn', () => {
    const n = node();
    brickDrag.started(n, 'a', false);
    expect(brickDrag.dropForTurn()).toBe(true);
    expect(brickDrag.takeResume('a')).toBe(false);
  });

  it('let go before the turned part was drawn: nothing to pick up', () => {
    const n = node();
    brickDrag.started(n, 'a', true);
    brickDrag.dropForTurn();
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(brickDrag.takeResume('a')).toBe(false);
  });

  it('a drag that ended forgets its part', () => {
    const n = node();
    brickDrag.started(n, 'a', true);
    brickDrag.ended(node()); // some other node
    expect(brickDrag.active()).toBe(true);
    brickDrag.ended(n);
    expect(brickDrag.active()).toBe(false);
  });
});
