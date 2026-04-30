// Venue Properties dialog — port of VenueDialog.cpp.
// Edits name, enabled toggle, min walkway (ft), and per-edge kind/door-width/label.
// Also exposes a "Clear Venue" button.

import { useState, type FormEvent } from 'react';
import type * as Y from 'yjs';
import type { Venue, VenueEdge } from '@cld/bbm';
import { setVenue } from './mutations';

const STUDS_PER_FOOT = 38.09814081;

const EDGE_KINDS = ['Wall', 'Door', 'Open'] as const;

interface Props {
  doc: Y.Doc;
  venue: Venue | null;
  onClose: () => void;
}

export function VenuePropertiesDialog({ doc, venue, onClose }: Props) {
  const initial = venue ?? {
    name: '',
    enabled: true,
    minWalkwayStuds: 0,
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    edges: [],
    obstacles: [],
  };

  const [name, setName] = useState(initial.name);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [walkwayFt, setWalkwayFt] = useState((initial.minWalkwayStuds / STUDS_PER_FOOT).toFixed(2));
  const [edges, setEdges] = useState<VenueEdge[]>(initial.edges.map((e) => ({ ...e })));

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: Venue = {
      ...initial,
      name: name.trim(),
      enabled,
      minWalkwayStuds: (parseFloat(walkwayFt) || 0) * STUDS_PER_FOOT,
      edges,
    };
    setVenue(doc, next);
    onClose();
  }

  function clearVenue() {
    if (!confirm('Remove the entire venue from this project?')) return;
    setVenue(doc, null);
    onClose();
  }

  function patchEdge(i: number, patch: Partial<VenueEdge>) {
    setEdges((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  const inputCls = 'w-full rounded border border-neutral-700 bg-neutral-800 px-2 py-1.5 text-sm';
  const labelCls = 'block text-xs text-neutral-400 mb-0.5';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 overflow-y-auto">
      <form
        onSubmit={submit}
        className="w-full max-w-2xl space-y-4 rounded-lg border border-neutral-800 bg-neutral-900 p-6 text-sm"
      >
        <h3 className="text-lg font-semibold">Venue Properties</h3>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className={labelCls}>Min walkway (ft)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              className={inputCls}
              value={walkwayFt}
              onChange={(e) => setWalkwayFt(e.target.value)}
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-blue-500"
          />
          Render this venue
        </label>

        {edges.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Edges
            </p>
            <div className="overflow-auto rounded border border-neutral-800">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800 text-left text-neutral-500">
                    <th className="w-6 px-2 py-1">#</th>
                    <th className="px-2 py-1">Kind</th>
                    <th className="px-2 py-1">Door width (ft)</th>
                    <th className="px-2 py-1">Label</th>
                  </tr>
                </thead>
                <tbody>
                  {edges.map((edge, i) => (
                    <tr key={i} className="border-b border-neutral-900">
                      <td className="px-2 py-1 text-neutral-500">{i + 1}</td>
                      <td className="px-2 py-1">
                        <select
                          value={edge.kind}
                          onChange={(e) => patchEdge(i, { kind: Number(e.target.value) as 0|1|2 })}
                          className="rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5"
                        >
                          {EDGE_KINDS.map((k, v) => (
                            <option key={v} value={v}>{k}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          disabled={edge.kind !== 1}
                          value={(edge.doorWidthStuds / STUDS_PER_FOOT).toFixed(2)}
                          onChange={(e) =>
                            patchEdge(i, { doorWidthStuds: (parseFloat(e.target.value) || 0) * STUDS_PER_FOOT })
                          }
                          className="w-24 rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5 disabled:opacity-40"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={edge.label}
                          onChange={(e) => patchEdge(i, { label: e.target.value })}
                          className="w-full rounded border border-neutral-700 bg-neutral-800 px-1 py-0.5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {initial.obstacles.length > 0 && (
          <p className="text-xs text-neutral-500">
            <strong>{initial.obstacles.length}</strong> obstacle polygon(s) drawn.
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={clearVenue}
            className="rounded border border-red-900 px-3 py-1.5 text-sm text-red-400 hover:bg-red-950"
          >
            Clear Venue
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-neutral-700 px-4 py-1.5 text-sm hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-1.5 text-sm hover:bg-blue-500"
            >
              OK
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
