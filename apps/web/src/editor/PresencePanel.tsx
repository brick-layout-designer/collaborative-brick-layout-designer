import type { Awareness } from 'y-protocols/awareness';
import { useRemotePeers } from './useAwareness';

/** Shows everyone connected to the layout. Renders nothing if alone. */
export function PresencePanel({ awareness }: { awareness: Awareness | null }) {
  const peers = useRemotePeers(awareness);
  if (peers.length === 0) return null;
  return (
    <div className="border-l border-neutral-800 px-3 py-1 text-xs">
      <div className="flex items-center gap-2">
        {peers.map(({ clientId, state, isIdle }) => (
          <div
            key={clientId}
            title={`${state.user.displayName}${isIdle ? ' · idle' : ''}`}
            className="flex items-center gap-1"
          >
            <span
              className="inline-block h-3 w-3 rounded-full border border-black/30"
              style={{
                backgroundColor: state.user.color,
                opacity: isIdle ? 0.4 : 1,
              }}
            />
            <span className={isIdle ? 'text-neutral-500' : 'text-neutral-200'}>
              {state.user.displayName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
