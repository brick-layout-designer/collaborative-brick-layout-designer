// Profile › Your data: "Download my data". The server builds a zip in the
// background (a minute or two for a big library) and sends a notice and
// an email when it's ready; this list updates by itself (the live 'me'
// hint refetches ['my-exports']).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiSend } from '../api';

export interface DataExport {
  id: string;
  status: 'building' | 'ready' | 'failed';
  sizeBytes: number | null;
  error: string | null;
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  downloadedAt: number | null;
  downloadUrl: string | null;
}

export interface MyExports {
  exports: DataExport[];
  nextAllowedAt: number | null;
  everyHours: number;
  keepDays: number;
  maxMb: number;
}

export const privacyApi = {
  myExports: () => apiGet<MyExports>('/api/me/privacy/exports'),
  startExport: () => apiSend<{ export: DataExport }>('POST', '/api/me/privacy/exports', {}),
};

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ExportRow({ e }: { e: DataExport }) {
  return (
    <li data-testid="export-row" className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-b-0">
      <span className="text-sm">
        Asked for {when(e.createdAt)}
        {e.status === 'ready' && e.expiresAt && <span className="block text-xs text-muted">Ready · {formatSize(e.sizeBytes)} · until {when(e.expiresAt)}</span>}
        {e.status === 'building' && <span className="block text-xs text-muted">Being made… we’ll tell you when it’s ready.</span>}
        {e.status === 'failed' && <span className="block text-xs text-danger">{e.error}</span>}
      </span>
      {e.downloadUrl && (
        <a href={e.downloadUrl} download className="tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover">
          Download
        </a>
      )}
    </li>
  );
}

export function MyDataSection() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-exports'],
    queryFn: privacyApi.myExports,
    // While one is being made, look again now and then in case the live stream is down.
    refetchInterval: (query) => (query.state.data?.exports.some((e) => e.status === 'building') ? 5000 : false),
  });
  const start = useMutation({
    mutationFn: privacyApi.startExport,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-exports'] }),
  });
  const data = q.data;
  const waitUntil = data?.nextAllowedAt ?? null;
  return (
    <section id="my-data" className="scroll-mt-6 space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Your data</h2>
      <p className="text-sm text-muted">
        Get a copy of everything this site keeps about you: your account, your layouts and modules as files you can open, your parts, venues and
        pictures, and the record of what you did. It comes as one zip file.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={start.isPending || !data || waitUntil !== null}
          onClick={() => start.mutate()}
          className="tap-target rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-50"
        >
          Download my data
        </button>
        {waitUntil !== null && <span className="text-xs text-muted">You can ask again after {when(waitUntil)}.</span>}
      </div>
      {start.isError && <p className="text-sm text-danger">{(start.error as Error).message}</p>}
      {data && data.exports.length > 0 && (
        <ul className="rounded-lg border border-line">
          {data.exports.map((e) => (
            <ExportRow key={e.id} e={e} />
          ))}
        </ul>
      )}
      {data && (
        <p className="text-xs text-muted">
          Only you can download it, while signed in. It’s kept for {data.keepDays} day{data.keepDays === 1 ? '' : 's'}, then deleted. You can ask for
          one every {data.everyHours} hour{data.everyHours === 1 ? '' : 's'}.
        </p>
      )}
    </section>
  );
}
