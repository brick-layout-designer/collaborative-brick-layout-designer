// Publish + subscribe to awareness state.
//
// The publisher hook batches local state into a single Awareness update,
// debounced lightly (cursor position can fire on every mousemove). The
// subscriber hook returns a stable list of remote peers, sorted for UI.
//
// Awareness is bound to the WS provider's `Awareness` instance — the
// y-websocket layer broadcasts our state to peers and surfaces their
// state in `awareness.getStates()`.

import { useEffect, useMemo, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { useEditorStore } from './editorStore';
import {
  deterministicColor,
  IDLE_MS,
  type AwarenessCursor,
  type AwarenessState,
  type AwarenessUser,
} from './awareness';
import type { Me } from '../api';

interface UsePublishOpts {
  awareness: Awareness | null;
  me: Me | null;
  layoutId: string;
}

/**
 * Build and publish the local user's awareness state. Reads from the
 * editor store (selection, tool, cursor) and combines with the user's
 * identity. Each store change triggers a single `awareness.setLocalState`
 * call — the y-websocket layer batches the wire update.
 */
export function usePublishAwareness({ awareness, me, layoutId }: UsePublishOpts): void {
  const tool = useEditorStore((s) => s.tool);
  const selection = useEditorStore((s) => s.selection);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  // Cursor in stud coordinates. Tracked at the canvas level via a
  // window-level event so we don't have to thread state through React.
  const [cursor, setCursor] = useState<AwarenessCursor | null>(null);

  // Tap into a global custom event the canvas dispatches on mousemove.
  // Decouples awareness publishing from the canvas implementation.
  //
  // Raw mousemove fires far faster than we need to broadcast a cursor
  // (60-120+ Hz) — without throttling, every pixel of movement (including
  // while dragging a brick) triggered a React state update AND a
  // WebSocket awareness broadcast, competing with the drag for the main
  // thread. Coalesce to one update per animation frame instead: same
  // perceived smoothness, far fewer renders/broadcasts.
  useEffect(() => {
    let pending: AwarenessCursor | null | undefined;
    let raf: number | null = null;
    function flush() {
      raf = null;
      if (pending !== undefined) {
        setCursor(pending);
        pending = undefined;
      }
    }
    function onMove(e: Event) {
      const detail = (e as CustomEvent<AwarenessCursor>).detail;
      pending = detail;
      if (raf === null) raf = requestAnimationFrame(flush);
    }
    function onLeave() {
      pending = null;
      if (raf === null) raf = requestAnimationFrame(flush);
    }
    window.addEventListener('cld-cursor-move', onMove);
    window.addEventListener('cld-cursor-leave', onLeave);
    return () => {
      window.removeEventListener('cld-cursor-move', onMove);
      window.removeEventListener('cld-cursor-leave', onLeave);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!awareness || !me) return;
    const user: AwarenessUser = {
      id: me.id,
      displayName: me.displayName,
      avatarUrl: me.avatarUrl,
      color: deterministicColor(me.id, layoutId),
    };
    const cursorWithLayer: AwarenessCursor | null =
      cursor && activeLayerId
        ? { x: cursor.x, y: cursor.y, layerId: activeLayerId }
        : cursor;
    const state: AwarenessState = {
      user,
      cursor: cursorWithLayer,
      selection: { brickIds: selection },
      tool,
      lastActivityMs: Date.now(),
    };
    awareness.setLocalState(state);
  }, [awareness, me, layoutId, tool, selection, activeLayerId, cursor]);
}

/**
 * Subscribe to remote peers' awareness and return a tick-stable list.
 * Excludes the local clientID. Sorted by displayName for UI consistency.
 */
export function useRemotePeers(awareness: Awareness | null): {
  clientId: number;
  state: AwarenessState;
  isIdle: boolean;
}[] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!awareness) return;
    const onChange = () => setTick((t) => t + 1);
    awareness.on('change', onChange);
    return () => awareness.off('change', onChange);
  }, [awareness]);

  return useMemo(() => {
    if (!awareness) return [];
    const now = Date.now();
    const peers: { clientId: number; state: AwarenessState; isIdle: boolean }[] = [];
    for (const [clientId, raw] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const state = raw as AwarenessState | undefined;
      if (!state || !state.user) continue;
      peers.push({
        clientId,
        state,
        isIdle: now - state.lastActivityMs > IDLE_MS,
      });
    }
    peers.sort((a, b) => a.state.user.displayName.localeCompare(b.state.user.displayName));
    void tick;
    return peers;
  }, [awareness, tick]);
}

/**
 * Helper for the canvas to dispatch cursor events. Defined here so the
 * event name stays in one place; both the publisher and the canvas
 * import from this file.
 */
export function dispatchCursorMove(studX: number, studY: number): void {
  window.dispatchEvent(
    new CustomEvent<AwarenessCursor>('cld-cursor-move', {
      detail: { x: studX, y: studY, layerId: null },
    }),
  );
}

export function dispatchCursorLeave(): void {
  window.dispatchEvent(new Event('cld-cursor-leave'));
}
