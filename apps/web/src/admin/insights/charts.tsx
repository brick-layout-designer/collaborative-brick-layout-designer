// Hand-rolled SVG charts for the admin dashboard. Loaded only with the
// dashboard chunk, so the app's main bundle doesn't carry them.
//
// Every chart is a <figure> with a title, a one-sentence text summary
// (also its accessible name), a "Show as table" fallback and a CSV
// download. Colors: one series per chart in the validated slot-1 blue
// (see the dataviz palette); text always uses the theme's ink tokens.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { describeSeries, downloadCsv, formatCompact, formatDay, niceTicks, toCsv } from './format';

const DEFAULT_W = 600;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

/** Series color, light and dark (validated against --panel). */
export const SERIES_STYLE = `
.cld-viz { --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; }
:root[data-theme='dark'] .cld-viz { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; }
@media (prefers-color-scheme: dark) { :root:not([data-theme]) .cld-viz { --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; } }
`;

function CsvButton({ name, header, rows }: { name: string; header: string[]; rows: (string | number | null)[][] }) {
  return (
    <button
      type="button"
      onClick={() => downloadCsv(name, toCsv(header, rows))}
      className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:bg-soft hover:text-ink"
      aria-label={`Download ${name} as CSV`}
    >
      CSV
    </button>
  );
}

export function Card({ title, note, actions, children }: { title: string; note?: ReactNode | undefined; actions?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="min-w-0 rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold text-ink">
          {title}
        </h3>
        {actions}
      </div>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** "Collecting since 3 Sep" note for numbers the server only started keeping recently. */
export function CollectingNote({ since }: { since: string | null | undefined }) {
  if (since === undefined) return null;
  if (since === null) return <>Not collected yet: numbers start once people use the site.</>;
  return <>Collecting since {formatDay(Date.parse(`${since}T00:00:00Z`))}.</>;
}

export interface LineChartProps {
  title: string;
  values: number[];
  starts: number[];
  bucket: 'day' | 'week';
  format?: (n: number) => string;
  /** 'total' sums the series in the summary; 'level' reads it as a running level (DAU, disk). */
  how?: 'total' | 'level';
  note?: ReactNode;
}

/** One measure over time: a 2px line with a 10% wash, crosshair + tooltip, keyboard stepping. */
export function LineChart({ title, values, starts, bucket, format = formatCompact, how = 'total', note }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLElement>(null);
  // Draw at the card's real width, so axis text stays 11px on a phone
  // instead of shrinking with a scaled-down viewBox.
  const [W, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setW(Math.max(240, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const summary = describeSeries(title, values, starts, bucket, format, how);
  const max = Math.max(0, ...values);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const n = values.length;
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right));
  const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = n > 0 ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - PAD.left) / 80))));
  const dateLabel = (i: number) => (bucket === 'week' ? `Week of ${formatDay(starts[i]!)}` : formatDay(starts[i]!));

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || n === 0) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const cur = hover ?? (e.key === 'ArrowRight' ? -1 : n);
      setHover(Math.min(n - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
    } else if (e.key === 'Escape') setHover(null);
  };

  return (
    <Card
      title={title}
      note={note}
      actions={<CsvButton name={title} header={[bucket === 'week' ? 'Week starting' : 'Day', title]} rows={values.map((v, i) => [new Date(starts[i]!).toISOString().slice(0, 10), v])} />}
    >
      <figure ref={boxRef} className="cld-viz relative m-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-accent"
          role="img"
          aria-label={summary}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--muted)" className="tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {values.map((_, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill="var(--muted)">
                {formatDay(starts[i]!)}
              </text>
            ) : null,
          )}
          <path d={area} fill="var(--series-1)" opacity={0.1} />
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {n > 0 && (
            <circle cx={x(n - 1)} cy={y(values[n - 1]!)} r={4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
          )}
          {hover !== null && (
            <g aria-hidden>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(values[hover]!)} r={4} fill="var(--series-1)" stroke="var(--panel)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-lg border border-line bg-panel px-2 py-1 text-xs shadow"
            style={{ left: `${Math.min(80, Math.max(0, (x(hover) / W) * 100 - 10))}%` }}
          >
            <strong className="block text-sm text-ink tabular-nums">{format(values[hover]!)}</strong>
            <span className="text-muted">{dateLabel(hover)}</span>
          </div>
        )}
        <figcaption className="mt-2 text-xs text-muted">{summary}</figcaption>
      </figure>
      <DataDetails header={[bucket === 'week' ? 'Week starting' : 'Day', title]} rows={values.map((v, i) => [formatDay(starts[i]!), format(v)])} />
    </Card>
  );
}

/** "Show as table" fallback under a chart. */
export function DataDetails({ header, rows }: { header: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer select-none py-1 text-muted hover:text-ink">Show as table</summary>
      <div className="mt-1 max-h-64 overflow-auto">
        <table className="w-full text-left">
          <thead className="text-muted">
            <tr>
              {header.map((h) => (
                <th key={h} scope="col" className="px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => (
                  <td key={j} className={'px-2 py-1 ' + (j > 0 ? 'tabular-nums' : '')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface BarItem {
  label: string;
  value: number;
  /** Extra text after the value (e.g. "12 layouts"). */
  detail?: string;
}

/** Ranked horizontal bars (breakdowns). Values sit at the bar tips in ink, never in the series color. */
export function BarList({
  title,
  items,
  format = formatCompact,
  note,
  unit,
  empty = 'Nothing yet.',
}: {
  title: string;
  items: BarItem[];
  format?: (n: number) => string;
  note?: ReactNode | undefined;
  unit: string;
  empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, b) => a + b.value, 0);
  const summary = useMemo(() => {
    if (items.length === 0 || total === 0) return `${title}: ${empty}`;
    const top = items[0]!;
    return `${title}: ${top.label} leads with ${format(top.value)} ${unit}${total > 0 ? ` (${Math.round((top.value / total) * 100)}%)` : ''}, out of ${items.length} in the list.`;
  }, [items, title, total, format, unit, empty]);
  return (
    <Card title={title} note={note} actions={<CsvButton name={title} header={['Name', unit]} rows={items.map((i) => [i.label, i.value])} />}>
      {items.length === 0 || total === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <figure className="cld-viz m-0">
          <ul className="space-y-2" aria-label={summary}>
            {items.map((it) => (
              <li key={it.label} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-ink" title={it.label}>
                    {it.label}
                  </span>
                  <span className="shrink-0 text-muted tabular-nums">
                    {format(it.value)}
                    {it.detail ? ` · ${it.detail}` : ''}
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-soft" aria-hidden>
                  <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: 'var(--series-1)' }} />
                </div>
              </li>
            ))}
          </ul>
          <figcaption className="mt-2 text-xs text-muted">{summary}</figcaption>
        </figure>
      )}
    </Card>
  );
}

export interface Column<T> {
  label: string;
  value: (row: T) => string | number | null;
  /** Display text, when different from the CSV value. */
  render?: (row: T) => ReactNode;
  align?: 'right';
}

/** A table card with CSV export. Scrolls sideways inside its card on a phone. */
export function DataTable<T>({
  title,
  rows,
  columns,
  note,
  empty = 'Nothing to show.',
  rowKey,
}: {
  title: string;
  rows: T[];
  columns: Column<T>[];
  note?: ReactNode;
  empty?: string;
  rowKey: (row: T) => string;
}) {
  return (
    <Card
      title={title}
      note={note}
      actions={<CsvButton name={title} header={columns.map((c) => c.label)} rows={rows.map((r) => columns.map((c) => c.value(r)))} />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                {columns.map((c) => (
                  <th key={c.label} scope="col" className={'whitespace-nowrap px-2 py-1.5 font-medium ' + (c.align === 'right' ? 'text-right' : '')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={rowKey(r)} className="border-t border-line">
                  {columns.map((c) => (
                    <td key={c.label} className={'px-2 py-1.5 ' + (c.align === 'right' ? 'text-right tabular-nums' : '')}>
                      {c.render ? c.render(r) : (c.value(r) ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** A big-number tile with an optional change against a named earlier value. */
export function StatTile({ label, value, sub, delta }: { label: string; value: string; sub?: ReactNode | undefined; delta?: { from: number; to: number; period: string } | undefined }) {
  let deltaText: ReactNode = null;
  if (delta && delta.from > 0) {
    const pct = Math.round(((delta.to - delta.from) / delta.from) * 100);
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '■';
    deltaText = (
      <span className="text-xs text-muted">
        <span aria-hidden>{arrow} </span>
        {pct > 0 ? '+' : ''}
        {pct}% {delta.period}
      </span>
    );
  }
  return (
    <div className="min-w-0 rounded-xl border border-line bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {(sub || deltaText) && (
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
          {deltaText}
          {sub}
        </p>
      )}
    </div>
  );
}
