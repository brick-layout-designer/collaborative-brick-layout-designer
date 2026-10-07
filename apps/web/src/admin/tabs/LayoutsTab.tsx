// Admin › Layouts: every layout, across people and clubs, a page at a time.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBytes } from '../insights/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { confirmDelete, toastDeleted } from '../../ui/ConfirmDialog';
import { Loading, Td, Th, Toolbar } from './shared';

export function LayoutsTab() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const list = useQuery({
    queryKey: ['admin-layouts', q, offset, limit],
    queryFn: () => api.admin.layouts({ q, offset, limit }),
  });
  const removeLayout = useMutation({
    mutationFn: (id: string) => api.admin.deleteLayout(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-layouts'] }),
  });
  return (
    <section>
      <Toolbar
        q={q}
        setQ={(v) => {
          setQ(v);
          setOffset(0);
        }}
        total={list.data?.total ?? 0}
        offset={offset}
        limit={limit}
        setOffset={setOffset}
        placeholder="Search by title…"
      />
      {list.isLoading ? (
        <Loading />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs uppercase tracking-wider text-muted">
              <tr>
                <Th>Title</Th>
                <Th>Owner</Th>
                <Th align="right">Size</Th>
                <Th>Updated</Th>
                <Th>Doc v</Th>
                <Th>Expires</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data?.layouts.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <Td>
                    <Link to={`/editor/${l.id}`} className="tap-target inline-flex items-center text-accent-text hover:underline">
                      {l.title}
                    </Link>
                  </Td>
                  <Td className="text-xs text-muted">
                    {l.ownerOrgName ?? l.ownerUserEmail ?? (l.ownerUserId ? '(deleted user)' : '—')}
                  </Td>
                  <Td align="right" className="tabular-nums text-muted">{formatBytes(l.sizeBytes)}</Td>
                  <Td>{new Date(l.updatedAt).toLocaleString()}</Td>
                  <Td>{l.docVersion}</Td>
                  <Td>{l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '—'}</Td>
                  <Td align="right">
                    <button
                      onClick={async () => {
                        const ok = await confirmDelete(l.title, {
                          removes: 'The layout, its history and its share links are deleted for everyone who can open it.',
                          keeps: 'The modules, parts and venues it uses aren’t deleted.',
                          typeName: true,
                        });
                        if (ok) removeLayout.mutate(l.id, { onSuccess: () => toastDeleted(l.title) });
                      }}
                      className="rounded-lg border border-red-900 px-2 py-0.5 text-xs text-red-300 hover:bg-red-900/40"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
