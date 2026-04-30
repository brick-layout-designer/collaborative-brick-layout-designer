// Awareness state schema and helpers.
//
// Awareness is Yjs's *ephemeral* per-client metadata channel. It lives
// outside the doc state — never persisted, broadcast as updates over WS.
// We use it for:
//
//   - cursor position (renders the other user's cursor on the canvas)
//   - selection (renders dashed outlines on the bricks they've selected)
//   - tool (informational; could change cursor icon)
//   - identity (id, displayName, avatarUrl, color)
//   - idle flag (5min no movement → grey dot)
//
// The shape must round-trip through structuredClone (Yjs requires it),
// so plain JSON-able objects only.

export interface AwarenessUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  /** Deterministic per (user_id, layout_id) so a user has the same colour everywhere. */
  color: string;
}

export interface AwarenessCursor {
  /** World position in studs, or null if cursor is outside the canvas. */
  x: number;
  y: number;
  layerId: string | null;
}

export interface AwarenessState {
  user: AwarenessUser;
  cursor: AwarenessCursor | null;
  selection: { brickIds: string[] };
  tool: string;
  /** Unix-millis of the last activity. Compared client-side for idle dot. */
  lastActivityMs: number;
}

const COLOR_PALETTE = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
];

/**
 * Deterministic colour for a user-on-a-layout. Plan §4.5 calls this
 * out: same user always gets the same colour for the same map, so
 * peers don't visually swap mid-session.
 */
export function deterministicColor(userId: string, layoutId: string): string {
  const seed = `${userId}:${layoutId}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length] ?? '#888888';
}

/** Idle threshold (ms). After this much inactivity a peer's dot turns grey. */
export const IDLE_MS = 5 * 60 * 1000;
