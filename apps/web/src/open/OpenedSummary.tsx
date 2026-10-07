// After a file opens as a new layout: "Opened Yard.bbm: 1,204 parts, 37
// not in the library", with the list of those parts and what the
// conversion skipped. Parts not in the library stay on the map;
// uploading them as custom parts draws them.

import { useId, useMemo, useState } from 'react';
import type { BbmMap } from '@cld/model';
import type { PartWire } from '../api';
import { HelpButton } from '../help/HelpButton';
import { summarizeMap, summaryLine } from './openFiles';

export function OpenedSummaryCard({
  name,
  map,
  index,
  warnings,
  onClose,
  lifted = false,
}: {
  name: string;
  map: BbmMap;
  index: ReadonlyMap<string, PartWire>;
  warnings: readonly string[];
  onClose: () => void;
  /** Editing by touch: above the touch bar. */
  lifted?: boolean;
}) {
  const summary = useMemo(() => summarizeMap(map, index), [map, index]);
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  return (
    <div className={`pointer-events-none fixed inset-x-0 z-40 flex px-4 sm:justify-start ${lifted ? 'bottom-36' : 'bottom-12'}`}>
      <div
        role="status"
        data-testid="opened-summary"
        className="pointer-events-auto w-full max-w-md rounded-card border border-line bg-panel px-4 py-3 text-sm text-ink shadow-lg"
      >
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 break-words">
            <span data-testid="opened-summary-line">{summaryLine(name, summary)}</span>
            {summary.missing > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  aria-expanded={listOpen}
                  aria-controls={listId}
                  onClick={() => setListOpen((v) => !v)}
                  className="font-semibold text-accent-text hover:underline"
                >
                  {listOpen ? '(hide list)' : '(list)'}
                </button>
              </>
            )}
          </p>
          <HelpButton helpKey="open.formats" />
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-control px-1.5 text-muted hover:bg-soft hover:text-ink">
            ×
          </button>
        </div>
        {listOpen && (
          <ul id={listId} data-testid="missing-parts" className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line bg-soft px-3 py-2 text-xs">
            {summary.missingParts.map((p) => (
              <li key={p.partNumber} className="flex justify-between gap-3">
                <span className="font-mono">{p.partNumber}</span>
                <span className="text-muted">× {p.count.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ul>
        )}
        {summary.missing > 0 && listOpen && (
          <p className="mt-2 text-xs text-muted">They stay on the map. Upload them as custom parts on Home to draw them.</p>
        )}
        {warnings.map((w) => (
          <p key={w} className="mt-1 text-xs text-amber-400">
            {w}
          </p>
        ))}
      </div>
    </div>
  );
}
