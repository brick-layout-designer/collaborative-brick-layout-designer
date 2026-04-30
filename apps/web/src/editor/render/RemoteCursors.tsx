import { Group, Line, Rect, Text } from 'react-konva';
import type { Awareness } from 'y-protocols/awareness';
import type { BbmMap, Brick } from '@cld/model';
import { useRemotePeers } from '../useAwareness';
import { studToPx } from './coords';

/**
 * Renders remote peers' cursors + their selection outlines onto the
 * canvas. Pure: re-renders when awareness ticks. The presence panel
 * (sidebar) lives in PresencePanel.tsx and shares the same hook.
 */
export function RemoteCursors({
  awareness,
  map,
}: {
  awareness: Awareness | null;
  map: BbmMap;
}) {
  const peers = useRemotePeers(awareness);
  if (!awareness || peers.length === 0) return null;

  // Index every brick by id once so the per-peer selection lookup is
  // O(selection-size) rather than O(layers × bricks × selection-size).
  const brickIndex = new Map<string, Brick>();
  for (const layer of map.layers) {
    if (layer.type === 'brick') {
      for (const b of layer.bricks) brickIndex.set(b.id, b);
    }
  }

  return (
    <Group>
      {peers.map(({ clientId, state }) => (
        <Group key={clientId} listening={false}>
          {state.selection.brickIds.map((id) => {
            const brick = brickIndex.get(id);
            if (!brick) return null;
            // Outline the brick's display area in the peer's colour
            // — semi-transparent so it doesn't drown out the local
            // selection's solid blue dashes.
            return (
              <Rect
                key={id}
                x={studToPx(brick.displayArea.x) - 1}
                y={studToPx(brick.displayArea.y) - 1}
                width={studToPx(brick.displayArea.width) + 2}
                height={studToPx(brick.displayArea.height) + 2}
                stroke={state.user.color}
                strokeWidth={2}
                opacity={0.6}
                listening={false}
              />
            );
          })}
          {state.cursor && (
            <Group x={studToPx(state.cursor.x)} y={studToPx(state.cursor.y)}>
              {/* Arrow shape: pointer triangle. */}
              <Line
                points={[0, 0, 0, 16, 4, 12, 9, 22, 11, 21, 7, 11, 12, 11]}
                fill={state.user.color}
                stroke="#000"
                strokeWidth={0.5}
                closed
              />
              {/* Name pill — drawn after the arrow so it overlaps. */}
              <Rect
                x={14}
                y={2}
                width={state.user.displayName.length * 7 + 12}
                height={16}
                fill={state.user.color}
                cornerRadius={3}
              />
              <Text
                text={state.user.displayName}
                x={20}
                y={5}
                fontSize={10}
                fill="#fff"
                listening={false}
              />
            </Group>
          )}
        </Group>
      ))}
    </Group>
  );
}
