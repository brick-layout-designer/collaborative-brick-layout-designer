import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiTokenSummary } from '../api';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function scopeSummary(t: Pick<ApiTokenSummary, 'scopes'>): string {
  const has = (s: ApiTokenSummary['scopes'][number]) => t.scopes.includes(s);
  const parts = [has('layouts:write') ? 'Read & edit' : 'Read only'];
  if (has('layouts:create')) parts.push('publish layouts');
  if (has('parts:write')) parts.push('upload parts');
  else if (has('parts:read')) parts.push('download parts');
  if (has('venues:write')) parts.push('save venues');
  else if (has('venues:read')) parts.push('download venues');
  if (has('account:prefs')) parts.push('sync settings');
  return parts.join(', ');
}

/**
 * Profile-page list of the desktop apps signed in to this account (API
 * tokens minted by the device-code flow), with Revoke. Revoking closes
 * the device's live connections straight away.
 */
export function DevicesSection() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: api.tokens.list });
  const revoke = useMutation({
    mutationFn: (id: string) => api.tokens.revoke(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });

  return (
    <section id="devices" className="scroll-mt-6 space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Devices</h2>
      <p className="text-sm text-muted">
        Desktop apps signed in to your account. To add one, choose “Sign in” in the desktop app and
        follow its instructions.
      </p>
      {tokens.isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : tokens.isError ? (
        <p className="text-sm text-danger">{(tokens.error as Error).message}</p>
      ) : tokens.data!.tokens.length === 0 ? (
        <p className="rounded-lg border border-line px-4 py-3 text-sm text-muted">
          No devices signed in.
        </p>
      ) : (
        <ul className="rounded-lg border border-line">
          {tokens.data!.tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-4 border-b border-line px-4 py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate">
                  {t.name}{' '}
                  <span className="font-mono text-xs text-muted">
                    {t.prefix}…{t.last4}
                  </span>
                </div>
                <div className="text-xs text-muted">
                  {scopeSummary(t)} · Created {formatDate(t.createdAt)} · Last used{' '}
                  {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'never'} · Expires {formatDate(t.expiresAt)}
                </div>
              </div>
              <button
                onClick={() => {
                  if (confirm(`Revoke access for “${t.name}”? The device will be signed out.`)) revoke.mutate(t.id);
                }}
                disabled={revoke.isPending}
                aria-label={`Revoke ${t.name}`}
                className="shrink-0 text-sm text-danger hover:underline disabled:opacity-50"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && <p className="text-sm text-danger">{(revoke.error as Error).message}</p>}
    </section>
  );
}
