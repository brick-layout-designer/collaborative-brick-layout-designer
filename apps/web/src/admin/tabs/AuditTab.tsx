// Admin › Audit log: everything that happened, a page at a time.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AdminAuditEvent } from '../../api';
import { Loading, Td, Th } from './shared';

const AUDIT_PAGE = 50;

export function AuditTab() {
  const [offset, setOffset] = useState(0);
  const log = useQuery({
    queryKey: ['admin-audit', offset],
    queryFn: () => api.admin.auditLog({ limit: AUDIT_PAGE, offset }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-neutral-300">Platform audit log</h2>
      {log.isLoading && <Loading />}
      {log.data && (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <Th>Time</Th><Th>Event</Th><Th>User</Th><Th>Resource</Th><Th>Payload</Th>
              </tr>
            </thead>
            <tbody>
              {log.data.events.map((e: AdminAuditEvent) => (
                <tr key={e.id} className="border-b border-line hover:bg-panel/40">
                  <Td>{new Date(e.createdAt).toLocaleString()}</Td>
                  <Td>{e.eventType}</Td>
                  <Td>{e.userName ?? e.userId ?? '—'}</Td>
                  <Td className="font-mono text-[10px] text-muted">{e.layoutId ?? (e.resourceKind ? `${e.resourceKind}:${e.resourceId}` : '—')}</Td>
                  <Td>
                    <details>
                      <summary className="cursor-pointer text-muted pointer-coarse:min-w-11">view</summary>
                      <pre className="mt-1 max-w-xs overflow-auto whitespace-pre-wrap text-neutral-300">
                        {JSON.stringify(e.payload, null, 2)}
                      </pre>
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-3 text-xs text-muted">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - AUDIT_PAGE))}
              className="rounded-lg border border-border px-2 py-1 hover:bg-soft disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="py-1">
              {offset + 1}–{offset + (log.data.events.length)} of {log.data.total}
            </span>
            <button
              disabled={offset + AUDIT_PAGE >= log.data.total}
              onClick={() => setOffset(offset + AUDIT_PAGE)}
              className="rounded-lg border border-border px-2 py-1 hover:bg-soft disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
