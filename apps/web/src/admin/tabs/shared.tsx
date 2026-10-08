// Bits the admin sections share: the list toolbar (search, paging), table cells, loading.

import { Link } from 'react-router-dom';

export function Toolbar({
  q,
  setQ,
  total,
  offset,
  limit,
  setOffset,
  placeholder,
}: {
  q: string;
  setQ: (v: string) => void;
  total: number;
  offset: number;
  limit: number;
  setOffset: (n: number) => void;
  placeholder: string;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-panel px-3 py-1.5 text-sm sm:w-72"
      />
      <span className="text-xs text-muted">
        {start}–{end} of {total.toLocaleString()}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={() => setOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft disabled:opacity-30"
        >
          Prev
        </button>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={end >= total}
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-soft disabled:opacity-30"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th className={'px-3 py-2 ' + (align === 'right' ? 'text-right' : '')}>{children}</th>
  );
}

export function Td({ children, align, className }: { children: React.ReactNode; align?: 'right'; className?: string }) {
  return (
    <td
      className={
        'px-3 py-2 ' + (align === 'right' ? 'text-right ' : '') + (className ?? '')
      }
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Global Parts tab
// ---------------------------------------------------------------------------


export function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}

export function Forbidden() {
  return (
    <div className="grid min-h-screen place-items-center text-muted">
      <div className="rounded-lg border border-red-900 bg-red-950/30 p-6 text-center">
        <p className="font-semibold text-red-300">Forbidden</p>
        <p className="mt-1 text-sm">This page is restricted to platform admins.</p>
        <Link to="/" className="mt-3 inline-block text-sm text-accent-text hover:underline">
          ← Back to app
        </Link>
      </div>
    </div>
  );
}
