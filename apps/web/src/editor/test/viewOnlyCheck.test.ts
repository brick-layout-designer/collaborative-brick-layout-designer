// When someone's access goes down to view only while a layout is open, the
// layout starts again from the server's copy, and their own is kept if it
// holds edits the server lacks (useLayoutDoc, holdsEditsServerLacks).

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { holdsEditsServerLacks } from '../useLayoutDoc';

/** A doc as the server has it, and a copy synced from it that reads the same types. */
function pair(): { server: Y.Doc; mine: Y.Doc } {
  const server = new Y.Doc();
  server.transact(() => {
    server.getMap('meta').set('title', 'Yard');
    server.getArray('layers').push(['a', 'b']);
  });
  const mine = new Y.Doc();
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(server));
  mine.getMap('meta');
  mine.getArray('layers');
  return { server, mine };
}

describe('holdsEditsServerLacks', () => {
  it('a copy with nothing of its own holds nothing more, even after others edit', () => {
    const { server, mine } = pair();
    expect(holdsEditsServerLacks(server, mine)).toBe(false);
    server.getMap('meta').set('title', 'Yard 2');
    expect(holdsEditsServerLacks(server, mine)).toBe(false);
  });

  it('an edit, an addition or a deletion of mine is something it lacks', () => {
    let { server, mine } = pair();
    mine.getMap('meta').set('title', 'Mine');
    expect(holdsEditsServerLacks(server, mine)).toBe(true);
    ({ server, mine } = pair());
    mine.getArray('layers').push(['c']);
    expect(holdsEditsServerLacks(server, mine)).toBe(true);
    ({ server, mine } = pair());
    mine.getArray('layers').delete(0, 1);
    expect(holdsEditsServerLacks(server, mine)).toBe(true);
  });
});
