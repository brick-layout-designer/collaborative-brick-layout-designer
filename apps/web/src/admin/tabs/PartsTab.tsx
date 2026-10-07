// Admin › Parts: the site-wide parts everyone sees.

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AdminGlobalPart, type OrgSummary } from '../../api';
import { CategoryPicker } from '../../parts/CategoryPicker';
import { confirmDelete, toastDeleted } from '../../ui/ConfirmDialog';
import { Loading, Td, Th } from './shared';

export function GlobalPartsTab() {
  const qc = useQueryClient();
  const parts = useQuery({ queryKey: ['admin-global-parts'], queryFn: api.admin.globalParts });
  const catalog = useQuery({ queryKey: ['parts-catalog'], queryFn: api.parts.catalog, staleTime: 5 * 60 * 1000 });
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: api.orgs.list });
  const existingCategories = Array.from(
    new Set((catalog.data?.parts ?? []).map((p) => p.category || 'Custom').filter(Boolean))
  ).sort();

  // Upload form state
  const [form, setForm] = useState({
    partNumber: '',
    displayName: '',
    category: 'Custom',
    orgSlug: '',
  });
  const xmlRef = useRef<HTMLInputElement>(null);
  const spriteRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['admin-global-parts'] });
    qc.invalidateQueries({ queryKey: ['parts-catalog'] });
    qc.invalidateQueries({ queryKey: ['custom-parts'] });
  }

  const deletePart = useMutation({
    mutationFn: (id: string) => api.admin.deleteGlobalPart(id),
    onSuccess: invalidateAll,
  });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setUploadErr('');
    const xmlFile = xmlRef.current?.files?.[0];
    if (!xmlFile) { setUploadErr('XML file required'); return; }
    const spriteFile = spriteRef.current?.files?.[0];
    if (!spriteFile) { setUploadErr('Sprite file required'); return; }
    if (!['image/gif', 'image/png'].includes(spriteFile.type)) {
      setUploadErr('Sprite must be a GIF or PNG'); return;
    }
    const spriteBytes = await spriteFile.arrayBuffer();
    const spriteBase64 = btoa(String.fromCharCode(...new Uint8Array(spriteBytes)));
    const xmlText = await xmlFile.text();
    const xmlBase64 = btoa(unescape(encodeURIComponent(xmlText)));
    setUploading(true);
    try {
      if (form.orgSlug) {
        // Route to org-owned custom part
        await api.customParts.create({
          partNumber: form.partNumber.trim(),
          displayName: form.displayName.trim(),
          category: form.category.trim() || 'Custom',
          xmlBase64,
          spriteBase64,
          spriteMime: spriteFile.type as 'image/gif' | 'image/png',
          orgSlug: form.orgSlug,
        });
      } else {
        await api.admin.createGlobalPart({
          partNumber: form.partNumber.trim(),
          displayName: form.displayName.trim(),
          category: form.category.trim() || 'Custom',
          xmlBase64,
          spriteBase64,
          spriteMime: spriteFile.type as 'image/gif' | 'image/png',
        });
      }
      setForm({ partNumber: '', displayName: '', category: 'Custom', orgSlug: '' });
      if (xmlRef.current) xmlRef.current.value = '';
      if (spriteRef.current) spriteRef.current.value = '';
      invalidateAll();
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">Upload global part</h2>
        <form onSubmit={handleUpload} className="space-y-3 rounded-lg border border-line p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Part number
              <input
                value={form.partNumber}
                onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))}
                className="rounded-lg border border-border bg-panel px-2 py-1 text-ink"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Display name
              <input
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                className="rounded-lg border border-border bg-panel px-2 py-1 text-ink"
                required
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-muted">
              <CategoryPicker
                categories={existingCategories}
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Owner club (optional)
              <select
                value={form.orgSlug}
                onChange={(e) => setForm((f) => ({ ...f, orgSlug: e.target.value }))}
                className="rounded-lg border border-border bg-panel px-2 py-1 text-ink"
              >
                <option value="">Global (all users)</option>
                {(orgs.data?.orgs ?? []).map((o: OrgSummary) => (
                  <option key={o.slug} value={o.slug}>{o.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Part XML (.xml)
              <input ref={xmlRef} type="file" accept=".xml,application/xml,text/xml" required
                className="text-neutral-300" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Sprite file (.gif / .png)
              <input ref={spriteRef} type="file" accept="image/gif,image/png" required
                className="text-neutral-300" />
            </label>
          </div>
          {uploadErr && <p className="text-xs text-danger">{uploadErr}</p>}
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-accent-hover px-3 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload global part'}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-neutral-300">
          Global parts ({parts.data?.parts.length ?? '…'})
        </h2>
        {parts.isLoading && <Loading />}
        {parts.data && parts.data.parts.length === 0 && (
          <p className="text-xs text-muted">No global parts yet.</p>
        )}
        {parts.data && parts.data.parts.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-muted">
                <Th>Part #</Th><Th>Name</Th><Th>Category</Th><Th>Sprite</Th><Th>Added</Th><Th>{''}</Th>
              </tr>
            </thead>
            <tbody>
              {parts.data.parts.map((p: AdminGlobalPart) => (
                <tr key={p.id} className="border-b border-line hover:bg-panel/40">
                  <Td>{p.partNumber}</Td>
                  <Td>{p.displayName}</Td>
                  <Td>{p.category}</Td>
                  <Td>{p.spriteMime.split('/')[1]?.toUpperCase()}</Td>
                  <Td>{new Date(p.createdAt).toLocaleDateString()}</Td>
                  <Td>
                    <button
                      onClick={async () => {
                        const ok = await confirmDelete(p.displayName, {
                          removes: 'The part leaves the site-wide parts library for everyone.',
                          keeps: 'Layouts that use it show a placeholder in its place.',
                        });
                        if (ok) deletePart.mutate(p.id, { onSuccess: () => toastDeleted(p.displayName) });
                      }}
                      className="text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Part Libraries tab — mirrors desktop Download Center + Library Paths dialog.
// Three install paths:
//   1. Base library  — register the bundled BlueBrickParts (already on disk)
//   2. Download Center — search official/non-LEGO BlueBrick sources, checkbox
//                        list, one-click download + install (server-side proxy)
//   3. Manual        — upload a local zip, or paste a direct zip URL
// ---------------------------------------------------------------------------
