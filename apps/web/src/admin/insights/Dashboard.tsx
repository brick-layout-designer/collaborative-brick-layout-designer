// The platform admin's dashboard: a range picker, a "needs attention"
// list, headline numbers, graphs over time, and breakdowns of usage,
// content, people and server health. Lazy-loaded from AdminPage, so
// none of this (charts included) is in the app's main bundle.

import { useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarList, Card, CollectingNote, DataTable, LineChart, SERIES_STYLE, StatTile, type BarItem } from './charts';
import { desktopVersionBars } from './desktopVersions';
import { formatAgo, formatBytes, formatCompact, formatDate, formatDuration } from './format';
import { insightsApi, RANGES, type KeyValue, type RangeId } from './insightsApi';

const RANGE_KEY = 'cld.admin.range';

function loadRange(): RangeId {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    if (RANGES.some((r) => r.id === v)) return v as RangeId;
  } catch {
    /* storage blocked */
  }
  return '30d';
}

function saveRange(r: RangeId): void {
  try {
    localStorage.setItem(RANGE_KEY, r);
  } catch {
    /* storage blocked */
  }
}

const CLIENT_LABELS: Record<string, string> = {
  web: 'Web app',
  desktop: 'Desktop app',
  phone: 'Phone',
  tablet: 'Tablet',
  computer: 'Computer',
  standalone: 'Installed app',
  browser: 'Browser tab',
  bbm: 'BlueBrick file (.bbm)',
  zip: 'Zip (.bbm + extras)',
  sidecar: 'Extras file (.bbm.bld)',
  password: 'Email and password',
  google: 'Google',
  github: 'GitHub',
  oidc: 'Single sign-on',
};

function toBars(rows: KeyValue[], label: (k: string) => string = (k) => CLIENT_LABELS[k] ?? k): BarItem[] {
  return rows.map((r) => ({ label: label(r.key), value: r.value }));
}

export default function Dashboard() {
  const [range, setRange] = useState<RangeId>(loadRange);
  const qc = useQueryClient();
  // Refetch keeps the frame: the previous range stays on screen while the next loads.
  const keep = { placeholderData: keepPreviousData };
  const series = useQuery({ queryKey: ['admin-series', range], queryFn: () => insightsApi.series(range), ...keep });
  const usage = useQuery({ queryKey: ['admin-usage', range], queryFn: () => insightsApi.usage(range), ...keep });
  // Refresh also recounts placed parts (the server caches that scan for an hour).
  const [rescan, setRescan] = useState(0);
  const content = useQuery({ queryKey: ['admin-content', range, rescan], queryFn: () => insightsApi.content(range, rescan > 0), ...keep });
  const people = useQuery({ queryKey: ['admin-people', range], queryFn: () => insightsApi.people(range), ...keep });
  const health = useQuery({ queryKey: ['admin-health', range], queryFn: () => insightsApi.health(range), ...keep });
  const alerts = useQuery({ queryKey: ['admin-alerts'], queryFn: insightsApi.alerts });

  const pick = (r: RangeId) => {
    setRange(r);
    saveRange(r);
  };
  const refresh = () => {
    setRescan((n) => n + 1);
    for (const k of ['admin-series', 'admin-usage', 'admin-people', 'admin-health', 'admin-alerts']) {
      void qc.invalidateQueries({ queryKey: [k] });
    }
  };
  const fetching = [series, usage, content, people, health].some((q) => q.isFetching);

  const s = series.data;
  const since = s?.collectingSince ?? {};
  const chart = (title: string, key: keyof NonNullable<typeof s>['series'], opts: { how?: 'total' | 'level'; note?: ReactNode; format?: (n: number) => string } = {}) =>
    s ? <LineChart title={title} values={s.series[key]} starts={s.buckets} bucket={s.bucket} {...opts} /> : <Placeholder title={title} />;

  const u = usage.data;
  const c = content.data;
  const p = people.data;
  const h = health.data;

  return (
    <div className="space-y-8" aria-busy={fetching}>
      <style>{SERIES_STYLE}</style>
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Time range" className="inline-flex flex-wrap rounded-lg border border-line bg-panel p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={range === r.id}
              onClick={() => pick(r.id)}
              className={
                'min-h-11 rounded-md px-3 text-sm sm:min-h-9 ' +
                (range === r.id ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-soft hover:text-ink')
              }
            >
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={refresh} className="min-h-11 rounded-lg border border-line px-3 text-sm text-muted hover:bg-soft hover:text-ink sm:min-h-9">
          Refresh
        </button>
        {fetching && <span className="text-xs text-muted">Updating…</span>}
      </div>

      <AttentionPanel alerts={alerts.data?.alerts} loading={alerts.isLoading} />

      <section aria-labelledby="dash-headline" className={fetching ? 'opacity-80 transition-opacity' : ''}>
        <h2 id="dash-headline" className="sr-only">
          Headline numbers
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="People" value={p ? formatCompact(p.totals.users) : '…'} sub={p ? `${p.totals.unverified} unverified` : undefined} />
          <StatTile label="Active today" value={u ? formatCompact(u.now.dau) : '…'} delta={u ? { from: u.weekAgo.dau, to: u.now.dau, period: 'vs a week ago' } : undefined} />
          <StatTile label="Active this week" value={u ? formatCompact(u.now.wau) : '…'} delta={u ? { from: u.weekAgo.wau, to: u.now.wau, period: 'vs a week ago' } : undefined} />
          <StatTile label="Active this month" value={u ? formatCompact(u.now.mau) : '…'} delta={u ? { from: u.weekAgo.mau, to: u.now.mau, period: 'vs a week ago' } : undefined} />
          <StatTile label="Layouts" value={c ? formatCompact(c.totals.layouts) : '…'} sub={c ? formatBytes(c.totals.layoutBytes) : undefined} />
          <StatTile
            label="Live now"
            value={h ? String(h.live.connections) : '…'}
            sub={h ? `${h.live.rooms} layout${h.live.rooms === 1 ? '' : 's'} open` : undefined}
          />
        </div>
      </section>

      <Section id="dash-time" title="Over time">
        {chart('New people', 'newUsers')}
        {chart('Active people per day', 'activeUsers', { how: 'level', note: <CollectingNote since={since.dau} /> })}
        {chart('Layouts created', 'layoutsCreated')}
        {chart('Layouts edited', 'layoutsEdited', { note: <>Layouts changed each day. <CollectingNote since={since.layouts_edited ?? null} /></> })}
        {chart('Live editing sessions', 'liveSessions', { note: <CollectingNote since={since.live_sessions ?? null} /> })}
        {chart('Custom parts added', 'customParts')}
        {chart('Modules saved', 'modules')}
        {chart('Share links opened', 'shareViews', { note: <CollectingNote since={since.share_views ?? null} /> })}
      </Section>

      <Section id="dash-usage" title="How people use it">
        <BarList title="Web or desktop" unit="person-days" items={u ? toBars(u.clients) : []} note={<>Each person counts once a day. <CollectingNote since={since.client ?? null} /></>} />
        <BarList
          title="Desktop versions"
          unit="person-days"
          items={u ? desktopVersionBars(u.desktopVersions, u.desktopPolicy) : []}
          empty="No desktop app seen in this period."
          note={u?.desktopPolicy ? `Version ${u.desktopPolicy.minimum} or newer can connect; ${u.desktopPolicy.recommended} or newer is recommended.` : undefined}
        />
        <BarList title="Phone or computer" unit="person-days" items={u ? toBars(u.devices) : []} note="Web app only." />
        <BarList title="Installed app or browser" unit="person-days" items={u ? toBars(u.display) : []} note={<>Web app only. <CollectingNote since={since.display ?? null} /></>} />
        <Card title="New and returning">
          {u ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat term="New people" value={formatCompact(u.newVsReturning.newPersonDays)} />
              <Stat term="Returning" value={formatCompact(u.newVsReturning.returningPersonDays)} />
              <Stat term="Live sessions" value={formatCompact(u.liveSessions)} />
              <Stat term="Average live session" value={u.avgLiveSessionMinutes === null ? '—' : `${u.avgLiveSessionMinutes} min`} />
              <Stat term="Share links opened" value={formatCompact(u.shareViews)} />
            </dl>
          ) : (
            <Loading />
          )}
        </Card>
        <BarList title="Downloads from the server" unit="downloads" items={u ? toBars(u.exports) : []} note="Pictures are made in the browser and aren’t counted." />
      </Section>

      <Section id="dash-content" title="Content">
        <BarList
          title="Storage by club"
          unit="bytes"
          format={formatBytes}
          items={
            c
              ? [
                  { label: 'Personal (all people)', value: c.byOwner.personal.bytes, detail: `${c.byOwner.personal.layouts} layouts` },
                  ...c.byOwner.clubs.slice(0, 9).map((o) => ({ label: o.name, value: o.bytes, detail: `${o.layouts} layouts` })),
                ].sort((a, b) => b.value - a.value)
              : []
          }
          note="Layout content size, not disk use."
        />
        <DataTable
          title="Clubs’ layouts, venues and modules"
          rows={c?.byOwner.clubs ?? []}
          rowKey={(r) => r.orgId}
          columns={[
            { label: 'Club', value: (r) => r.name },
            { label: 'Layouts', value: (r) => r.layouts, align: 'right' },
            { label: 'Size', value: (r) => r.bytes, render: (r) => formatBytes(r.bytes), align: 'right' },
            { label: 'Venues', value: (r) => r.rooms, align: 'right' },
            { label: 'Modules', value: (r) => r.modules, align: 'right' },
            { label: 'Custom parts', value: (r) => r.customParts, align: 'right' },
          ]}
        />
        <DataTable
          title="Largest layouts"
          rows={c?.largestLayouts ?? []}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Layout', value: (r) => r.title },
            { label: 'Owner', value: (r) => r.ownerOrgName ?? 'Personal' },
            { label: 'Size', value: (r) => r.bytes, render: (r) => formatBytes(r.bytes), align: 'right' },
            { label: 'Parts', value: (r) => r.parts, align: 'right' },
          ]}
        />
        <DataTable
          title="Most active layouts"
          note={<CollectingNote since={since.layout_edits ?? null} />}
          rows={c?.mostActiveLayouts ?? []}
          rowKey={(r) => r.id}
          empty="No edits in this period."
          columns={[
            { label: 'Layout', value: (r) => r.title },
            { label: 'Owner', value: (r) => r.ownerOrgName ?? 'Personal' },
            { label: 'Changes', value: (r) => r.edits, align: 'right' },
          ]}
        />
        <DataTable
          title={`Not opened in 90 days${c ? ` (${c.totals.staleLayouts})` : ''}`}
          note="Oldest first. Uses the last change for layouts not opened since counting began."
          rows={c?.staleLayouts ?? []}
          rowKey={(r) => r.id}
          empty="Every layout was opened in the last 90 days."
          columns={[
            { label: 'Layout', value: (r) => r.title },
            { label: 'Owner', value: (r) => r.ownerOrgName ?? 'Personal' },
            { label: 'Last opened', value: (r) => new Date(r.lastTouched).toISOString().slice(0, 10), render: (r) => formatDate(r.lastTouched), align: 'right' },
            { label: 'Size', value: (r) => r.bytes, render: (r) => formatBytes(r.bytes), align: 'right' },
          ]}
        />
        <DataTable
          title="Parts missing from every library"
          note="Placed in layouts but not in any installed library or custom part: good candidates to add."
          rows={c?.missingParts ?? []}
          rowKey={(r) => r.partNumber}
          empty="Every placed part is in a library."
          columns={[
            { label: 'Part', value: (r) => r.partNumber },
            { label: 'Placed', value: (r) => r.placements, align: 'right' },
            { label: 'Layouts', value: (r) => r.layouts, align: 'right' },
          ]}
        />
        <BarList
          title="Most used parts"
          unit="placements"
          items={(c?.topParts ?? []).slice(0, 10).map((p) => ({ label: p.partNumber, value: p.placements, detail: `${p.layouts} layouts` }))}
          note={c ? `Counted ${formatAgo(c.scan.at)} across ${c.scan.scanned} of ${c.scan.total} layouts.` : undefined}
        />
        <Card title="Totals">
          {c ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat term="Custom parts" value={`${formatCompact(c.totals.customParts)} · ${formatBytes(c.totals.customPartBytes)}`} />
              <Stat term="Modules" value={formatCompact(c.totals.modules)} />
              <Stat term="Venues" value={formatCompact(c.totals.rooms)} />
              <Stat term="Parts waiting for review" value="No review step" />
            </dl>
          ) : (
            <Loading />
          )}
        </Card>
      </Section>

      <Section id="dash-people" title="People and clubs">
        <BarList title="Sign-in methods" unit="people" items={(p?.signInMethods ?? []).map((m) => ({ label: CLIENT_LABELS[m.method] ?? m.method, value: m.users }))} note="A person with two methods counts in both." />
        <Card title="Accounts">
          {p ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat term="Unverified emails" value={formatCompact(p.totals.unverified)} />
              <Stat term="Not seen in 6 months" value={formatCompact(p.totals.dormant6m)} />
              <Stat term="Pending club invites" value={formatCompact(p.pending.clubInvites)} />
              <Stat term="Pending layout invites" value={formatCompact(p.pending.layoutInvites)} />
              <Stat term="Pending hand-overs" value={formatCompact(p.pending.transfers)} />
              <Stat term="Site admins" value={formatCompact(p.totals.admins)} />
            </dl>
          ) : (
            <Loading />
          )}
          <p className="mt-2 text-xs text-muted">“Not seen” uses the sign-up date for people not seen since counting began.</p>
        </Card>
        <DataTable
          title="Clubs by activity"
          rows={p?.clubs ?? []}
          rowKey={(r) => r.id}
          columns={[
            { label: 'Club', value: (r) => r.name },
            { label: 'Members', value: (r) => r.members, align: 'right' },
            { label: 'Layouts', value: (r) => r.layouts, align: 'right' },
            { label: 'Changes in range', value: (r) => r.editsInRange, align: 'right' },
            { label: 'Last change', value: (r) => (r.lastChange ? new Date(r.lastChange).toISOString().slice(0, 10) : null), render: (r) => (r.lastChange ? formatDate(r.lastChange) : '—'), align: 'right' },
          ]}
        />
      </Section>

      <Section id="dash-health" title="Server health">
        <Card title="Server">
          {h ? (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Stat term="Version" value={h.version} />
              <Stat term="Running for" value={formatDuration(h.uptimeSeconds)} />
              <Stat term="Live connections" value={`${h.live.connections} in ${h.live.rooms} layouts`} />
              <Stat term="Error rate" value={`${h.requests.errorRatePct}%`} />
              <Stat term="Requests" value={formatCompact(h.requests.total)} />
              <Stat term={`Slower than ${h.requests.slowThresholdMs / 1000} s`} value={formatCompact(h.requests.slow)} />
            </dl>
          ) : (
            <Loading />
          )}
        </Card>
        <Card title="Disk">
          {h ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat term="Database" value={formatBytes(h.disk.databaseBytes)} />
                <Stat term="Growth in range" value={h.disk.databaseGrowthBytes === null ? '—' : `${h.disk.databaseGrowthBytes >= 0 ? '+' : ''}${formatBytes(Math.abs(h.disk.databaseGrowthBytes))}`} />
                <Stat term="Parts libraries" value={`${formatBytes(h.disk.partsBytes)} · ${formatCompact(h.parts.libraryParts)} parts`} />
                <Stat term="Backups" value={formatBytes(h.disk.backupsBytes)} />
              </dl>
              {h.disk.volume && <Meter label="Data disk used" pct={h.disk.volume.usedPct} detail={`${formatBytes(h.disk.volume.freeBytes)} free of ${formatBytes(h.disk.volume.totalBytes)}`} />}
            </>
          ) : (
            <Loading />
          )}
        </Card>
        {chart('Database size', 'dbBytes', { how: 'level', format: formatBytes, note: <CollectingNote since={since.db_bytes ?? null} /> })}
        {chart('Requests', 'requests', { note: <CollectingNote since={since.requests ?? null} /> })}
        {chart('Server errors (5xx)', 'errors5xx', { note: <CollectingNote since={since.requests ?? null} /> })}
        {chart('Refused requests (403 and 429)', 'refused', { note: <CollectingNote since={since.requests ?? null} /> })}
        <DataTable
          title="Refused requests by route"
          note="403 and 429 answers. A jump on one route can mean a firewall rule or a client bug."
          rows={h?.requests.refusedRoutes ?? []}
          rowKey={(r) => r.key}
          empty="None in this period."
          columns={[
            { label: 'Answer and route', value: (r) => r.key, render: (r) => <code className="break-all text-xs">{r.key}</code> },
            { label: 'Count', value: (r) => r.value, align: 'right' },
          ]}
        />
        <DataTable
          title="Routes with server errors"
          rows={h?.requests.errorRoutes ?? []}
          rowKey={(r) => r.key}
          empty="No server errors in this period."
          columns={[
            { label: 'Route', value: (r) => r.key, render: (r) => <code className="break-all text-xs">{r.key}</code> },
            { label: 'Errors', value: (r) => r.value, align: 'right' },
          ]}
        />
        <DataTable
          title="Slow routes"
          rows={h?.requests.slowRoutes ?? []}
          rowKey={(r) => r.key}
          empty="Nothing slow in this period."
          columns={[
            { label: 'Route', value: (r) => r.key, render: (r) => <code className="break-all text-xs">{r.key}</code> },
            { label: 'Slow answers', value: (r) => r.value, align: 'right' },
          ]}
        />
        <DataTable
          title="Backups"
          note={h ? (h.backups.enabled ? (h.backups.lastAt ? `Last backup ${formatAgo(h.backups.lastAt)}.` : 'No backup yet.') : 'Backups are turned off on this server.') : undefined}
          rows={h?.backups.files ?? []}
          rowKey={(r) => r.name}
          empty="No backup files found."
          columns={[
            { label: 'File', value: (r) => r.name },
            { label: 'Made', value: (r) => new Date(r.at).toISOString(), render: (r) => formatDate(r.at), align: 'right' },
            { label: 'Size', value: (r) => r.bytes, render: (r) => formatBytes(r.bytes), align: 'right' },
          ]}
        />
      </Section>
      <p className="text-xs text-muted">
        Numbers are counts only: no pages visited, no IP addresses. Daily counts are kept for about 13 months.
      </p>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-base font-semibold text-ink">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Stat({ term, value }: { term: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{term}</dt>
      <dd className="mt-0.5 break-words font-medium text-ink">{value}</dd>
    </div>
  );
}

function Meter({ label, pct, detail }: { label: string; pct: number; detail: string }) {
  const tone = pct > 90 ? 'var(--danger)' : pct > 80 ? '#c98500' : 'var(--series-1)';
  return (
    <div className="cld-viz mt-4">
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-ink tabular-nums">
          {pct > 80 && <span aria-hidden>⚠ </span>}
          {pct}%
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-soft" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: tone }} />
      </div>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </div>
  );
}

function AttentionPanel({ alerts, loading }: { alerts: { level: 'warn' | 'info'; id: string; text: string }[] | undefined; loading: boolean }) {
  return (
    <section aria-labelledby="dash-attention" className="rounded-xl border border-line bg-panel p-4">
      <h2 id="dash-attention" className="text-sm font-semibold text-ink">
        Needs attention
      </h2>
      {loading ? (
        <Loading />
      ) : !alerts || alerts.length === 0 ? (
        <p className="mt-1 text-sm text-ok">
          <span aria-hidden>✓ </span>All clear: backups, disk, errors and refused requests look normal.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {alerts.map((a) => (
            <li key={a.id} className="flex gap-2 text-sm text-ink">
              <span aria-hidden className={a.level === 'warn' ? 'text-danger' : 'text-muted'}>
                {a.level === 'warn' ? '⚠' : 'ⓘ'}
              </span>
              <span>
                <span className="sr-only">{a.level === 'warn' ? 'Warning: ' : 'Note: '}</span>
                {a.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <Card title={title}>
      <Loading />
    </Card>
  );
}

function Loading() {
  return <p className="text-sm text-muted">Loading…</p>;
}
